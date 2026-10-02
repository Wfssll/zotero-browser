# 隐私说明 / Privacy

Zotero Browser 没有自建数据收集服务器，没有分析统计或广告 SDK。
浏览网页时，网站会正常收到网络请求和该站点的 Cookie，并按其自身政策处理数据。

- **检索与保存**：搜索关键词发送给用户选择的 Google 或 Bing。打开网页/PDF
  会访问对应网址。保存 arXiv 文献时，会把文章编号发送到 arXiv 元数据接口；
  PDF 下载来自原始站点或相应 arXiv 站点。
- **Cite**：仅在用户点击获取或批量运行时向 NASA ADS 发起查询；发送 arXiv 编号、
  DOI、ADS bibcode，或用于精确匹配的文章标题。不会上传 PDF 文件或整个资料库。
  默认访客会话来自 ADS 网站；可选个人 Token 使用 ADS 官方 API。Token 存放在
  Zotero/Gecko 登录管理器，不写入普通偏好、引用笔记或本项目源码。
- **翻译与生词**：选中的文本由用户安装的 Translate for Zotero 插件及其配置的
  翻译服务处理。中英记录写入 Zotero 笔记；其同步遵循用户的 Zotero 设置。
- **Cookie 导入**：仅在用户明确操作时读取所选浏览器的本地 Cookie；支持当前域名
  或全部网站。读取结果写入本机 Zotero 的 Cookie 存储，不发送给项目维护者。
  站点访问时会正常发送对应站点 Cookie。系统权限和浏览器支持因平台而异。
- **本地背景**：内置背景离线加载；导入图片复制到 Zotero 数据目录中的
  `zotero-browser-backgrounds`。删除导入背景仅删除副本，不删除原文件。
- **复制 PDF**：把当前本地 PDF 的文件对象写入系统剪贴板，不自动发送文件；
  用户在其他应用粘贴后，接收应用按其政策处理文件。
- **偏好与记录**：主页入口、书签、皮肤等存放在 Zotero 本地偏好；Cite 与生词笔记
  存放在用户资料库。卸载插件不会删除已保存笔记或用户导入的背景副本。

反馈问题时请不要公开 Token、Cookie、私人论文全文或资料库备份。

The plugin has no developer-operated collection server, analytics SDK or ads.
Websites receive normal requests and their cookies. Search terms go to the chosen
Google/Bing engine. arXiv metadata lookups send article identifiers. Explicit ADS
queries send identifiers or exact-match titles, not PDF files or a library dump.
Translation follows the separately installed translation plugin's providers.
Local settings, imported image copies and Zotero notes stay in local storage,
subject to your own Zotero sync configuration. Clipboard sharing requires your
paste action. Uninstalling preserves saved notes and imported image copies.
