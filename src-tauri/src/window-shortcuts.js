(() => {
  document.addEventListener("contextmenu", event => event.preventDefault(), true);
  document.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();
    if (key === "f12" || (event.ctrlKey && ["u", "s"].includes(key)) ||
        (event.ctrlKey && event.shiftKey && ["i", "j", "c"].includes(key))) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
})();
