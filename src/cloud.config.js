/* 云服务公开配置。
   这些值来自 workbuddy_cloud_service 激活后返回的 publicConfig，
   仅标识「哪个应用」，本身不带权限；服务端按来源域名做精确校验。
   不含任何长期密钥，可以随前端一起发布。 */
window.INNERSPACE_CLOUD_CONFIG = {
  endpoint: 'https://wbapp-awhpxwizaotbydtn10fn7g.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_aWhpxwIzAoTBydtn10Fn7g_qw46Z7IuO8nH82AWAcJmRoqi33Ie0TMt'
};
