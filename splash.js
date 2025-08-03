function doSomething() {
    let hashParams = new URLSearchParams(window.location.hash.substring(1));
    document.getElementById('count').innerText=hashParams.get('count')
}

if (document.readyState === "loading") {
  // Loading hasn't finished yet
  document.addEventListener("DOMContentLoaded", doSomething);
} else {
  // `DOMContentLoaded` has already fired
  doSomething();
}
