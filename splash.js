function doSomething() {
    let hashParams = new URLSearchParams(window.location.hash.substring(1));
    document.getElementById('count').innerText=hashParams.get('count')
    addButton();
}

function daButton() {
  chrome.runtime.sendMessage({'message':'clicked'});
}

function addButton() {
  let button = document.getElementById('mybutton');
  button.onclick=daButton;
}

if (document.readyState === "loading") {
  // Loading hasn't finished yet
  document.addEventListener("DOMContentLoaded", doSomething);
} else {
  // `DOMContentLoaded` has already fired
  doSomething();
}
