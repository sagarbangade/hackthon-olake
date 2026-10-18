// Ask OLake widget. Add to any page:
// <script src="https://YOUR-APP.vercel.app/widget.js" defer></script>
(function () {
  var host = new URL(document.currentScript.src).origin;

  var btn = document.createElement("button");
  btn.innerHTML = "Ask OLake";
  btn.style.cssText =
    "position:fixed;bottom:20px;right:20px;z-index:99999;padding:12px 18px;border:0;border-radius:24px;" +
    "background:#193ae6;color:#fff;font:600 14px system-ui;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)";

  var frame = document.createElement("iframe");
  frame.src = host + "/?embed=1";
  frame.title = "Ask OLake";
  frame.style.cssText =
    "position:fixed;bottom:76px;right:20px;z-index:99999;width:400px;height:600px;max-width:calc(100vw - 40px);" +
    "max-height:calc(100vh - 100px);border:0;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:none;background:#fff";

  btn.onclick = function () {
    var open = frame.style.display === "none";
    frame.style.display = open ? "block" : "none";
    btn.innerHTML = open ? "Close" : "Ask OLake";
  };

  document.body.appendChild(frame);
  document.body.appendChild(btn);
})();
