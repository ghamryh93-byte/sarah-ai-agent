(function () {
  "use strict"

  var SarahApp = {}

  SarahApp.state = {
    user: null,
    conversations: [],
    currentId: null,
    currentTitle: "",
    sending: false
  }

  SarahApp.$ = function (id) {
    return document.getElementById(id)
  }

  SarahApp.show = function (el) {
    if (el) el.classList.remove("hidden")
  }

  SarahApp.hide = function (el) {
    if (el) el.classList.add("hidden")
  }

  SarahApp.api = function (path, options) {
    options = options || {}

    var init = {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json" }
    }

    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body)
    }

    return fetch(path, init).then(function (res) {
      return res.json().catch(function () {
        return {}
      }).then(function (data) {
        if (!res.ok) {
          throw {
            status: res.status,
            error: (data && data.error) || "حصلت مشكلة، حاول تاني."
          }
        }
        return data
      })
    })
  }

  SarahApp.useSarahImage = function (imgEl, fallbackEl) {
    if (!imgEl || imgEl.dataset.initialized === "1") return
    imgEl.dataset.initialized = "1"

    imgEl.addEventListener("load", function () {
      imgEl.classList.add("visible")
      if (fallbackEl) fallbackEl.classList.add("hidden")
    })

    imgEl.addEventListener("error", function () {
      imgEl.classList.remove("visible")
      if (fallbackEl) fallbackEl.classList.remove("hidden")
    })

    imgEl.src = "/sarah.png"
  }

  SarahApp.boot = function () {
    SarahApp.api("/api/auth/me").then(function (data) {
      SarahApp.state.user = data.user
      SarahApp.enterChat()
    }).catch(function () {
      SarahApp.state.user = null
      SarahApp.enterAuth("login")
    })
  }

  window.SarahApp = SarahApp
})()
