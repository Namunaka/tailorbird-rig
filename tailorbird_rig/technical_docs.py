"""Page-level development specifications and requirements-to-tests coverage."""

from .config import ConfigError, confined, identifier
from .store import read


TDD_GUIDANCE = (
    '开发前先读目标版本的逐页技术文档和其中引用的契约，再对照当前设计稿。'
    '按功能 ID 逐项把验收用例写成可执行测试，先运行并确认测试因预期行为尚未实现而失败，'
    '再实现最小改动使测试通过，重构后跑相关回归。报告功能 ID、用例 ID、测试命令和结果。'
    '设计变更时同步修改适用的功能规格和用例；仅涉及视觉时记录变化及对应的视觉验收。'
    '技术规格缺失或不完整时先补齐已确认的规则，遇到无法确认的行为先澄清。'
)


def page_docs(root):
    return read(confined(root, 'page-docs.json'), {}).get('pages', {})


def _text(value):
    return isinstance(value, str) and bool(value.strip())


def _items(value):
    return isinstance(value, list) and bool(value) and all(map(_text, value))


def validate_technical(root, page, spec):
    def require(condition, message):
        if not condition:
            raise ConfigError(f'技术文档 {page}：{message}')

    require(isinstance(spec, dict), '缺少 technical 开发规格')
    requirements, cases = spec.get('requirements'), spec.get('cases')
    require(isinstance(requirements, list) and bool(requirements), '缺少功能规格')
    require(isinstance(cases, list) and bool(cases), '缺少测试用例')
    requirement_ids, case_ids, covered = set(), set(), set()
    for item in requirements:
        require(isinstance(item, dict), '功能规格必须为对象')
        ident = identifier(item.get('id'))
        require(ident not in requirement_ids, f'功能 ID 重复 {ident}')
        require(_text(item.get('title')) and _items(item.get('behavior')) and
                _items(item.get('implementation')), f'{ident} 缺少标题、行为或实现约束')
        requirement_ids.add(ident)
    for case in cases:
        require(isinstance(case, dict), '测试用例必须为对象')
        ident = identifier(case.get('id'))
        require(ident not in case_ids, f'用例 ID 重复 {ident}')
        requirement = case.get('requirement')
        require(isinstance(requirement, str) and requirement in requirement_ids,
                f'{ident} 未关联有效功能 ID')
        require(_text(case.get('title')) and _items(case.get('steps')) and
                _items(case.get('expected')) and
                ('setup' not in case or case['setup'] == [] or _items(case['setup'])),
                f'{ident} 缺少标题、操作步骤或断言')
        case_ids.add(ident)
        covered.add(requirement)
    require(covered == requirement_ids, '以下功能缺少测试用例：'+', '.join(sorted(requirement_ids-covered)))
    references = spec.get('references', [])
    require(isinstance(references, list), '技术依赖必须为列表')
    for reference in references:
        require(isinstance(reference, dict) and _text(reference.get('label')) and
                _text(reference.get('path')), '技术依赖需要名称和版本内路径')
        require(confined(root, reference['path']).is_file(), '缺少引用文件 '+reference['path'])


def validate_technical_pages(project, revision, page=None):
    root, manifest = project.revision(revision)
    if page is not None and page not in manifest['states']:
        raise ConfigError('未知技术文档页面：'+page)
    docs = page_docs(root)
    for state in [page] if page is not None else manifest['states']:
        validate_technical(root, state, docs.get(state, {}).get('technical'))


def validate_document_updates(project, previous, revision):
    from .page_checks import revision_content
    old = revision_content(project, previous)
    new = revision_content(project, revision)
    required = project.raw.get('require_technical_docs', False)
    for page in new.manifest['states']:
        technical = new.docs.get(page, {}).get('technical')
        previous_technical = old.docs.get(page, {}).get('technical')
        if technical is None and previous_technical is None and not required:
            continue
        if technical is not None:
            validate_technical(new.root, page, technical)
        if previous_technical is not None and technical is None:
            raise ConfigError(f'技术文档 {page}：发布时不能移除该页开发规格')
        if new.design_digest(page) == old.design_digest(page):
            continue
        if technical is None:
            raise ConfigError(f'技术文档 {page}：新增或改动设计稿须补齐开发规格和测试用例')
        if technical == previous_technical:
            raise ConfigError(f'技术文档 {page}：设计稿已修改，请同步更新开发规格或测试用例')
