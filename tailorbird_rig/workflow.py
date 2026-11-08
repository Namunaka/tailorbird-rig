"""Feedback handoff and explicit version/issue updates for the coding agent."""
from pathlib import Path
import json
from shlex import quote
from .config import Project
from .store import ReviewStore, read, atomic

SCOPE_GUIDANCE=(
    '批注标记的是问题发生的位置。逐条对照当前版本中同一功能的各机型、折叠形态和相关状态，'
    '判断问题只出现在单张图、部分机型，还是共用设计导致全部受影响。'
    '结合用户补充和实际稿件修复所有受影响的变体，逐一验证并用原问题号记录影响范围和证据。'
)
ALPHA_GUIDANCE=(
    '涉及开发或开发重测时，先按 coverage.json 的页面 × 机型和 page-docs.json 的测试用例列出覆盖矩阵。'
    '逐一在对应模拟器执行，折叠和展开独立；记录通过、失败、阻塞或未执行。关键路径抽测和构建通过不能替代逐页验收。'
    '仅用户明确限定或实际未开发的组合可登记范围例外，写明理由。'
    '通过的组合按当前版本在 implementation-evidence.json 登记构建号、模拟器截图与结果摘要。'
    '通过下方 Alpha 检查后才可标开发测试完成。仅改设计时保留开发状态。'
)

def handoff(config):
    store=ReviewStore(config); snapshot=store.snapshot(); project=store.project
    with store.lock: issues=read(store.root/'issues.json',{})
    pending=[i for i in issues['issues'] if not project.is_closed(i.get('status',''))]
    alpha_check=f'tailorbird-rig check {quote(str(project.filename))} --revision {quote(project.current)} --require-alpha'
    lines=[f'# {project.raw.get("title",project.id)}：设计反馈交接',f'项目配置：{project.filename}',f'当前版本：{project.current}',
           '固定框架目录：'+str(Path(__file__).resolve().parent),
           '普通设计对话只修改项目设计、配置与生成器；不得修改固定框架或重封完整性基线。',
           '按原问题号逐项处理，先读取原稿、批注坐标及附图；完成后回写处理说明和证据。',
           SCOPE_GUIDANCE,
           ALPHA_GUIDANCE,
           'Alpha 检查命令：`'+alpha_check+'`',
           '所有问题处理后发布新修订；保持同一看稿地址，在现有标签页刷新，不新开标签页。','']
    from .components import load
    elements=load(project)
    lines += ['公共元素集：'+elements['source'],'元素集版本：'+elements['system']['version'],
              '先复用公共组件与设计 tokens；新增可复用元素先登记到项目元素集，避免各页面重复画相同控件。',
              '元素集为通用示例，尚未接入项目专属规范。' if elements['example'] else '项目元素集已接入；在新设计版本中维护定义与页面引用。','']
    for issue in pending:
        lines += [f'## 问题 {issue["number"]}：{issue.get("title") or issue.get("user_quote","")}',
                  issue.get('user_quote',''),f'来源：{issue.get("revision","")} / {issue.get("page","")} / {issue.get("device","")}']
        if issue.get('scope_note'):lines.append('用户补充范围：'+issue['scope_note'])
        mark=next((m for m in snapshot['marks'] if m['id']==issue.get('annotation_id')),None)
        if mark: lines += [f'源图SHA256：{mark.get("image_sha256","")}',f'批注：{json.dumps(mark,ensure_ascii=False)}']
        for attachment in issue.get('attachments',[]): lines.append('附图：'+str(store.root/'images'/attachment['id']))
        lines.append('')
    if not pending: lines.append('暂无待处理问题。')
    return {'project':project.id,'revision':project.current,'issues':pending,'scope_guidance':SCOPE_GUIDANCE,
            'alpha_guidance':ALPHA_GUIDANCE,'alpha_check':alpha_check,'markdown':'\n'.join(lines)}

def activate(config, revision, root):
    store=ReviewStore(config)
    with store.lock:
        project=Project(config); data=project.raw
        if revision in project.revisions:raise ValueError('Revision IDs are immutable; choose a new ID')
        from .config import identifier
        identifier(revision)
        root=Path(root).resolve();data['revisions'].append({'id':revision,'root':str(root)})
        # Validate a candidate configuration before replacing the live pointer.
        candidate=project.filename.with_name('.rig-candidate.json')
        if candidate.exists():raise ValueError('Candidate configuration already exists')
        try:
            atomic(candidate,{**data,'current_revision':revision}); trial=Project(candidate)
            trial.validate_assets()
            atomic(project.filename,{**data,'current_revision':revision})
        finally: candidate.unlink(missing_ok=True)

def update_issue(config, number, status, resolution, evidence):
    store=ReviewStore(config)
    with store.lock:
        store.recover();issues=read(store.root/'issues.json',{})
        issue=next(i for i in issues['issues'] if i['number']==number)
        issue.setdefault('history',[]).append({k:issue.get(k) for k in ['status','work','evidence','revision']})
        issue.update(status=status,work=resolution,evidence=evidence,resolved_revision=store.project.current)
        if issue.get('page') and issue.get('device'):
            from .page_checks import content_digest
            issue['resolved_content_sha256']=content_digest(store.project,store.project.current,issue['page'],issue['device'])
        atomic(store.root/'issues.json',issues)
