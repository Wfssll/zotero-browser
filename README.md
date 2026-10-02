# Zotero Browser

在 Zotero 中浏览学术网页与 PDF，获取 NASA ADS BibTeX，记录阅读中遇到的英文单词与句子。

An academic browser inside Zotero, with a manual NASA ADS citation popup,
source-specific bilingual vocabulary notes, and one-click local PDF copying.

[下载 / Releases](https://github.com/Wfssll/zotero-browser/releases) ·
[使用说明](docs/USAGE.md) · [问题反馈](https://github.com/Wfssll/zotero-browser/issues) ·
[隐私说明](PRIVACY.md)

> **首个公开预发布版：0.0.1。** 当前安装范围为 **Zotero 9.0.x**。
> 本机核验基于 macOS + Zotero 9.0.6；Windows/Linux 和完整安装包操作尚待验证。
> 界面目前主要为中文。它是独立社区插件，与 Zotero 和 NASA ADS 无官方隶属关系。

![主页与背景图库预览](docs/skin-gallery-preview.png)

上图为生产界面组件的浏览器预览；实际宿主布局会因窗口尺寸有所变化。

## 安装

1. 打开 [Releases](https://github.com/Wfssll/zotero-browser/releases)，下载
   `zotero-browser-0.0.1.xpi`（不要下载 GitHub 自动生成的 Source code 压缩包）。
2. Zotero → 工具 → 插件，点击齿轮 → 从文件安装插件，选择 `.xpi`。
3. 在主工具栏点击地球图标打开右侧浏览器；再次点击可折叠。也可用
   `Command + Shift + B`（macOS）或 `Ctrl + Shift + B`（Windows/Linux）。

生词功能需要另行安装并启用
[Translate for Zotero](https://github.com/windingwind/zotero-pdf-translate)。
其他功能不需要该翻译插件。

## 功能

| 功能 | 使用方式 |
| --- | --- |
| 多标签浏览器 | 浏览学术网页、打开 PDF；折叠再展开保留当前窗口中的页面 |
| 主页搜索 | 在横向搜索框直接输入关键词或网址；支持 Google / Bing |
| Cite 小浮窗 | 点击引用图标才查询；打开或切换 PDF 不自动弹出 |
| NASA ADS BibTeX | 显示、复制、另存 `.bib`、保存独立 Cite 笔记 |
| 批量引用 | 选中文章、分类及子分类、当前资料库；支持停止和重试 |
| 双语生词记录 | 按 PDF 分别记录英文、中文、页码和来源；重复内容不追加 |
| 复制本地 PDF | 阅读器中点击地球左侧复制图标；将实际文件放入剪贴板 |
| 皮肤与背景 | 十种配色、八张离线背景、图片预览与本地导入 |
| 当前页面缩放 | `Command/Ctrl + +` / `-` / `0`；各标签页独立保存会话内比例 |
| 保存到 Zotero | arXiv 元数据和 PDF；其他网页保存基础标题、网址和访问时间 |
| 可选 Cookie 导入 | 手动导入；macOS 可尝试本地浏览器 Cookie，不保证完整迁移登录 |

Cite 显示 ADS 返回的原始 BibTeX。没有可靠匹配时会提示原因，不用其他数据库的
结果冒充 ADS。批量任务建议在连接设置中配置
[个人 ADS Token](https://ui.adsabs.harvard.edu/user/settings/token)。

## 当前限制

- 此次预发布不宣称兼容 Zotero 7/8/10，也未完成 Windows/Linux 实机验证。
- 自动测试和本机 API/UI 核验不能替代安装包的完整操作测试。验证范围见
  [发布检查清单](docs/RELEASE_CHECKLIST.md)。
- 标签页和网页缩放目前主要保留在当前窗口会话中；尚无完整的重启会话恢复。
- 通用网页保存只提取基础字段；暂未完整接入 Zotero 站点 translators，重复保存
  可能创建重复条目。arXiv PDF 下载失败时保留文献条目并显示提示。
- ADS 访客接口可能变化或限流；批量任务未实现跨重启恢复。
- 内嵌浏览器可能受网站登录、人机验证或流媒体兼容性限制。可用“外部浏览器打开”。
- PDF 文件能否粘贴发送由接收应用决定；尚未逐一验证聊天应用。
- 首个预发布版需手动安装。稳定版更新通道暂为空，后续稳定发布才写入更新清单。

## 开发

Node.js 22+；打包还需要系统 `zip` 和 `unzip`。macOS / Ubuntu 可直接使用。
当前测试没有外部 Node 依赖，无需先安装依赖包。

```sh
npm test
npm run build
npm run release:assets
```

根目录生成开发安装包 `zotero-browser.xpi`；`dist/` 生成带版本的发布包、
SHA-256 校验文件及更新清单。测试不读取真实 Cookie，也不修改真实 Zotero 资料库。
GitHub Actions 在 Ubuntu 与 macOS 运行测试和打包。维护者可手动运行 Publish release
工作流；预发布默认开启，稳定版会更新 `updates.json`。

使用独立 Zotero profile 和数据目录开发。更多信息见
[CONTRIBUTING.md](CONTRIBUTING.md) 与 [发布检查清单](docs/RELEASE_CHECKLIST.md)。

## License

原创代码使用 [MIT](LICENSE)；PDF.js、CMaps 和字体保留各自许可，见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。背景是 AI 生成的风景插画，
不是所标注地点的实拍照片，生成提示词随源码保留。
