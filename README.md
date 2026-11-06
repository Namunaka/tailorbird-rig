# Tailorbird Rig

**面向 AI agent 协作的本地设计评审 harness：新建界面、多尺寸看稿、画图批注、交接问题、发布版本，并在原标签页更新。**

Local design review harness for AI-assisted UI design, persistent visual feedback, versioned revisions, and reproducible Lottie authoring.

框架提供稳定的评审工具；设计项目独立配置页面、目标尺寸、素材和版本；设计 agent 负责分析需求、生成界面和处理反馈。框架不会自行调用模型、读取聊天或向其他会话发消息。

本仓库只包含通用框架、合成示例、测试与文档。实际产品的设计稿、角色素材、项目配置、批注和上传图片由使用者在独立工作区保存，不随框架发布。

## 快速开始

要求 Python 3.10+，运行依赖 Pillow 10+。无前端构建步骤，Lottie 播放器随包提供，无 CDN 依赖。

```sh
git clone https://github.com/Namunaka/tailorbird-rig.git
cd tailorbird-rig
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .

tailorbird-rig init workspaces/demo
tailorbird-rig check workspaces/demo/rig.json
tailorbird-rig start workspaces/demo/rig.json --port 18766
```

浏览器打开 **http://127.0.0.1:18766/**。`start` 后台启动或复用匹配的服务，不打开新标签页；日志和 PID 在项目 `.rig/` 下。前台运行使用 `tailorbird-rig serve workspaces/demo/rig.json --port 18766`，按 Ctrl+C 停止。

服务仅监听本机，一个反馈目录只允许一个 HTTP 服务；不同项目使用不同端口。不提供多人远程托管或登录账户。

初始化包含 3 个页面状态、7 个尺寸/形态、21 张合成图片及一个 Lottie 动画。示例尺寸是**合成布局夹具**，不代表厂商设备参数。真实项目应核验物理尺寸、逻辑单位、安全区及折叠形态，见 [尺寸配置示例](docs/device-presets.json)。

## 看稿与反馈

1. 左侧选择页面，上方选择目标尺寸或折叠形态，可打开原图、切换历史版本。
2. 右侧画笔、矩形框或位置标记，写评论、附截图，点击「保存评论」；也可直接保存整页意见。
3. 点击「复制待处理问题给对话」或「下载问题交接」，交给能访问项目文件的设计 agent。
4. Agent 按问题号处理，记录结果与证据，生成独立的新设计版本并发布。
5. 跟随最新版的网页在原标签页更新，继续验稿即可。

固定工具包括浏览、选择/移动、画笔、矩形框、位置评论、颜色/粗细、撤销和删除。中间整块区域及图外留白都能标记；输入文字时 Delete 只编辑文字。附件支持上传、粘贴和拖入。

批注按**页面 × 尺寸 × 版本**隔离，保存源图 SHA256、评论修改和几何移动历史、撤回记录及稳定问题号。已完成问题收到补充会沿原号重开。保存评论只是记录反馈，开始修改仍由对话中的 agent 执行。

页面导航按钮的**背景色**表示检查进度：默认颜色为尚未确认；该界面批注处理完成后变黄，提醒回来复查；右侧点击「检查确认」后变绿。无批注的界面也可以确认。状态按机型隔离，刷新后保留；跨版本内容不变时保留确认，稿件或关联动画变化后恢复默认颜色，新的反馈也会取消旧确认。黄色或绿色的当前选中项使用描边区分，避免蓝色选中背景遮盖检查状态。

## 新建界面与跨会话接续

给已有项目新增界面的示例指令：

> 使用 Tailorbird Rig，为 `workspaces/demo/rig.json` 新增「计划详情」界面。先读取现有设计和需求，覆盖项目配置的目标尺寸及折叠形态，保留已有页面，将新页面加入目录，发布新版本并沿用原看稿地址。只修改项目层。

新产品使用独立工作区：

> 使用 Tailorbird Rig 为新产品创建独立设计工作区，设计欢迎页与资料填写页。配置、设计、问题记录和版本与其他产品隔离。

新会话可从运行中网页的 `/api/handoff` 获取配置绝对路径、当前版本、待处理问题、坐标和附图路径。**最可靠的交接是复制网页上的问题清单，并附网页地址**。截图本身没有可靠的定位信息；新会话必须能访问相应文件和本机服务。换电脑需要自行迁移工作区和素材。

交接示例：

> 读取这份 Tailorbird Rig 交接，定位原项目，按原问题号逐项处理。保留认可的设计，验证后发布新版本，保持原地址与标签页，不修改框架核心。

Agent 处理约定见 [AGENTS.md](AGENTS.md)。

## 接入自己的设计

```text
workspaces/demo/
├── rig.json
├── designs/
│   ├── v1/
│   │   ├── coverage.json
│   │   ├── screens/phone/welcome.png
│   │   └── animations/feedback/animation.json
│   └── v2/...
└── .rig/                 # 批注、问题、附件、服务日志
```

最小 `rig.json`：

```json
{
  "schema_version": 1,
  "id": "demo",
  "title": "示例产品设计",
  "current_revision": "v1",
  "data_dir": ".rig",
  "issue_prefix": "DEMO",
  "revisions": [{"id": "v1", "root": "designs/v1"}],
  "groups": [{"label": "首次使用", "states": ["welcome"]}],
  "links": []
}
```

对应 `designs/v1/coverage.json`：

```json
{
  "states": ["welcome"],
  "labels": {"welcome": "欢迎页"},
  "devices": [{"id": "phone", "name": "手机 · 示例尺寸", "w": 402, "h": 874}],
  "image_template": "screens/{device}/{state}.png"
}
```

为每个页面与尺寸组合提供 PNG。`w/h` 为设计布局尺寸；高分辨率导出可配置 `physicalW/physicalH`，与实际图片一致。新增页面时同步 `states`、`labels`、分组和各尺寸图片，再运行 `check`。

相对路径以配置文件或版本目录为基准，也支持显式绝对路径。`groups` 为 `{label, states}` 数组；未分组页面进入「设计页面」。`links` 为 `{label, url}` 数组，可接说明、交互演示等项目资源。`mounts` 支持显式授权的只读目录，不应挂载包含凭据或无关私人文件的目录。

完整样例见 [starter/rig.json](tailorbird_rig/starter/rig.json) 和 [coverage.json](tailorbird_rig/starter/designs/v1/coverage.json)。

## 问题处理与发布

```sh
tailorbird-rig feedback workspaces/demo/rig.json --format markdown

# 在独立目录生成 v2，保留 v1 的原图和批注，再发布。
tailorbird-rig publish workspaces/demo/rig.json \
  --revision v2 --root workspaces/demo/designs/v2

# 按实际验证结果回写；尚未解决的问题保持待处理。
tailorbird-rig resolve workspaces/demo/rig.json 12 \
  --resolution '已调整标题与按钮间距' \
  --evidence 'designs/v2/screens/phone/welcome.png'
```

版本 ID 和目录不复用，不原地覆盖已开始评审的设计图。发布先核验配置、全部图片和声明的动画，再原子切换当前版本，旧稿与旧批注保留。

`resolve` 将处理结果绑定到当前稿件内容，因此应先发布本轮新稿，再回写问题；它只会产生黄色待复查提示，不会替用户确认。绿色确认只由用户在网页点击。

默认每 3 秒检测新版本，在原标签页刷新并保留页面/尺寸选择。有未保存评论、上传或绘制时延后更新；主动选择的历史版本保持固定。设计已修改与用户已验收分别记录。

## Lottie 动画工作台

顶部进入「Lottie 动画工作台」，内置本地 lottie-web **5.12.2**：

- 导入/编辑 JSON、结构检查和动画起点生成。
- SVG / Canvas 实播、播放/暂停/重播、逐帧时间轴、速度及显式循环。
- 下载 JSON 与配套 Python 生成器，读取项目版本声明的动画。

```sh
tailorbird-rig lottie create workspaces/demo/animations/feedback \
  --motion draw --color '#1478ff' --duration 1.8
tailorbird-rig lottie inspect workspaces/demo/animations/feedback/animation.json
python workspaces/demo/animations/feedback/generator.py
```

起点支持 `bounce`、`pulse`、`draw`。复杂动画由项目生成器组合标准图层、关键帧及固定拓扑路径，可复用 `tailorbird_rig/lottie_core.py`，无需为单个产品修改播放器。

生成目录包含 `animation.json`、`generator.py`、`parameters.json`、`inspection.json`。将动画放进版本目录，并在该版 `coverage.json` 增加字段：

```json
"animations": [
  {"id": "feedback", "label": "完成反馈", "path": "animations/feedback/animation.json"}
]
```

结构检查不代替视觉或目标原生播放器验证。工作台不执行表达式、不加载远程资源。播放器参数见 [官方 loadAnimation 文档](https://github.com/airbnb/lottie-web/wiki/loadAnimation-options)。

## 导入旧记录

```sh
tailorbird-rig import-review \
  --store /path/to/legacy-review-store \
  --workspace /path/to/design-workspace \
  --output workspaces/imported
```

兼容 `issues.json + annotations.json + images/`，复制反馈并保留编号、状态、源图哈希、附件和历史，只读引用设计版本。导入后两份存储独立，不双向同步，应统一使用新入口。原数据的 `current_revision` 需能相对 `--workspace` 找到版本目录。

## 框架维护边界

| 层 | 内容 | 普通设计任务 |
| --- | --- | --- |
| 项目层 | 配置、设计图、项目生成器、动画、批注 | 可以更新 |
| 框架层 | `tailorbird_rig/`、固定交互、存储协议、契约、测试 | 需明确提出框架维护 |

启动和资源读取通过 `framework.lock.json` 检测未登记修改。明确维护框架时，修改代码、完成测试，再登记原因：

```sh
tailorbird-rig framework verify
tailorbird-rig framework seal --maintenance --reason '维护内容与验证结果'
```

这是维护约定和完整性检测，不是操作系统权限隔离；目录所有者仍能有意修改基线。普通设计任务不得重封基线绕过检查。固定能力见 [功能契约](docs/feature-contract.md)。

`workspaces/`、`.rig/`、本机环境、构建产物及测试截图默认被 Git 忽略。公开提交前仍需核对暂存文件。框架仓库不负责备份私有设计数据。

## 开发与验证

```sh
python -m unittest discover -s tests -v

# 浏览器测试的开发依赖
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/browser.cjs
```

测试使用临时项目和随机端口，不写真实反馈。支持 `PLAYWRIGHT_MODULE`、`CHROME_EXECUTABLE`、`PYTHON` 指定已有运行时。重建合成图片用 `python tests/generate_starter.py`，之后按维护流程更新基线。

代码入口：`config.py` 配置与路径边界；`store.py` 反馈事务与历史；`server.py` 本地服务；`workflow.py` 交接与发布；`web/` 固定交互；`starter/` 合成示例。[验证范围](docs/validation.md)。

## 许可证

框架采用 [MIT License](LICENSE)。lottie-web 保留其 [MIT 许可证](tailorbird_rig/web/vendor/lottie-LICENSE.md)。使用者的设计、素材和批注不会因为接入框架而改变权属或授权。
