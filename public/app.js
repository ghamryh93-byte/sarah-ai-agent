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
      headers: { "Content-Type": "application/json" },
      credentials: "include"
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

  /* ---------- Theme: light / dark (auto + persisted) ---------- */

  SarahApp.theme = (function () {
    "use strict"

    var KEY = "sarah-theme"
    var THEME_COLORS = { light: "#f8fafc", dark: "#0a1220" }

    var meta = document.querySelector('meta[name="theme-color"]')

    function system() {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
    }

    function saved() {
      try {
        return localStorage.getItem(KEY)
      } catch (e) {
        return null
      }
    }

    function current() {
      var s = saved()
      return s === "light" || s === "dark" ? s : system()
    }

    function apply(t) {
      if (t !== "light" && t !== "dark") t = "light"
      document.documentElement.setAttribute("data-theme", t)
      if (meta) meta.setAttribute("content", THEME_COLORS[t])
    }

    function toggle() {
      var next = current() === "dark" ? "light" : "dark"
      try {
        localStorage.setItem(KEY, next)
      } catch (e) {}
      apply(next)
      dispatchEvent(new CustomEvent("sarah:themechange", { detail: next }))
    }

    function init() {
      apply(current())

      var btn = document.getElementById("themeToggle")
      if (btn) {
        btn.hidden = false
        btn.addEventListener("click", toggle)
      }

      if (window.matchMedia) {
        var mq = window.matchMedia("(prefers-color-scheme: dark)")
        var onChange = function () {
          if (saved() === null) apply(system())
        }
        if (mq.addEventListener) mq.addEventListener("change", onChange)
        else if (mq.addListener) mq.addListener(onChange)
      }
    }

    return { init: init, apply: apply, toggle: toggle, current: current }
  })()

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", SarahApp.theme.init)
  } else {
    SarahApp.theme.init()
  }
})()
