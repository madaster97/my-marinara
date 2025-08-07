if (typeof browser === "undefined") {
    var browser = chrome;
}

function doSomething() {
    let hashParams = new URLSearchParams(window.location.hash.substring(1));
    document.getElementById('count').innerText=
      "Your completed count this cycle is: " + hashParams.get('count');
    document.getElementById('nextstatus').innerText=
      "Next Status is: " + hashParams.get('lastStatus') == 'active'
          ? 'break'
          : 'active';
    addButton();
}

function daButton() {
  browser.runtime.sendMessage({'message':'clicked'});
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
