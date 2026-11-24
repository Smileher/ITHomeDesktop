(() => {
  if (
    location.hostname !== "my.ruanmei.com" ||
    !location.pathname.startsWith("/user-login/")
  )
    return;
  const mode = new URL(location.href).searchParams.get("desktopMode");
  if (mode !== "wechat" && mode !== "app") return;
  // Keep the official QR generation, expiry, polling and authorization intact.
  const style = document.createElement("style");
  style.textContent =
    ".login{width:100%!important;min-width:0!important;padding:24px!important;box-sizing:border-box}.login>.main{width:100%!important;display:flex!important;justify-content:center}.login .form-panel,.login>.footer{display:none!important}.login .qr-panel{display:flex!important;flex-direction:column;align-items:center;width:100%!important;margin:0!important;padding:28px 0!important;border:0!important}.qr-wrapper{margin:24px 0!important}.panel-title{font-size:23px!important}.qr-switch{margin-top:24px!important}body{min-width:0!important}";
  const apply = () => {
    if (!style.isConnected && document.head) document.head.appendChild(style);
    const button = document.querySelector(".qr-switch");
    const title = document.querySelector(".qr-panel .panel-title");
    if (
      mode === "app" &&
      button &&
      title?.textContent?.includes("微信") &&
      !document.documentElement.dataset.desktopQrSelected
    ) {
      document.documentElement.dataset.desktopQrSelected = "true";
      button.click();
    }
  };
  const observer = new MutationObserver(apply);
  observer.observe(document, { childList: true, subtree: true });
  apply();
  setTimeout(() => observer.disconnect(), 30000);
})();
