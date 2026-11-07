"""Continue an explicitly bound local Codex conversation from a review workspace."""

import json
import shutil
import subprocess
import threading
from uuid import UUID

from .workflow import handoff


class WorkError(ValueError):
    pass


class CodexWork:
    def __init__(self):
        self.lock = threading.Lock()
        self.state = 'idle'

    def source(self, project):
        value = project.raw.get('codex_source')
        if not value:
            return None
        try:
            thread_id = str(UUID(value['thread_id']))
            directory = (project.base / value.get('cwd', '.')).resolve()
            if not directory.is_dir():
                raise ValueError('Missing workspace')
            title = value.get('title') or thread_id
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise WorkError('来源对话配置无效，请检查项目配置。') from exc
        return thread_id, directory, title

    def status(self, project):
        source = self.source(project)
        with self.lock:
            return {'source': source[2] if source else None, 'state': self.state}

    def start(self, project, revision):
        if revision != project.current:
            raise WorkError('请切换到当前版本后再开始工作。')
        source = self.source(project)
        if not source:
            raise WorkError('这个项目还没有绑定 Codex 来源对话。')
        executable = shutil.which('codex')
        if not executable:
            raise WorkError('找不到 Codex CLI，请检查本机安装。')
        thread_id, directory, title = source
        with self.lock:
            if self.state in ('starting', 'running'):
                return {'source': title, 'state': self.state}
            bundle = handoff(project.filename)
            if revision != bundle['revision']:
                raise WorkError('当前设计版本已更新，请刷新后再开始工作。')
            if not bundle['issues']:
                raise WorkError('没有待处理问题。请先保存批注评论。')
            numbers = '、'.join(str(issue['number']) for issue in bundle['issues'])
            prompt = (
                f'用户在 Tailorbird Rig 点击了「开始工作」。请继续这份设计稿的评审修改。\n'
                f'项目配置：{project.filename}\n'
                f'当前版本：{revision}\n'
                f'待处理问题编号：{numbers}\n'
                '请用项目的 feedback 命令重新读取这些待处理问题，查看原稿、批注和附图，按原编号修改。'
                '按项目的评审约定发布新修订、回写已解决问题，保留历史版本与批注。'
                '确认通过由用户操作。'
            )
            argv = [executable, '-C', str(directory), '-s', 'workspace-write',
                    'exec', '--json', 'resume', '--skip-git-repo-check', thread_id, '-']
            try:
                process = subprocess.Popen(
                    argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL, text=True, encoding='utf-8',
                    start_new_session=True,
                )
            except OSError as exc:
                raise WorkError('无法启动本机 Codex CLI。') from exc
            self.state = 'starting'
            threading.Thread(target=self._watch, args=(process, prompt), daemon=True).start()
            return {'source': title, 'state': self.state}

    def _watch(self, process, prompt):
        outcome = None
        try:
            with process.stdin:
                process.stdin.write(prompt)
            with process.stdout:
                for line in process.stdout:
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if event.get('type') == 'turn.started':
                        with self.lock:
                            self.state = 'running'
                    elif event.get('type') == 'turn.completed':
                        outcome = 'completed'
                    elif event.get('type') == 'turn.failed':
                        outcome = 'failed'
        except (OSError, UnicodeError):
            outcome = 'failed'
        finally:
            result = process.wait()
            with self.lock:
                self.state = 'completed' if result == 0 and outcome == 'completed' else 'failed'
