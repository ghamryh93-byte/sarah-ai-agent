(function () {
  "use strict"

  var app = window.SarahApp

  var AUTH_VIEWS = ["login", "register", "forgot", "reset"]

  function showForm(mode) {
    for (var i = 0; i < AUTH_VIEWS.length; i++) {
      var form = app.$(AUTH_VIEWS[i] + "Form")
      if (form) {
        form.classList.toggle("hidden", AUTH_VIEWS[i] !== mode)
      }
      var error = app.$(AUTH_VIEWS[i] + "Error")
      if (error) error.textContent = ""
      var success = app.$(AUTH_VIEWS[i] + "Success")
      if (success) success.textContent = ""
    }
  }

  app.enterAuth = function (mode) {
    app.show(app.$("authView"))
    app.hide(app.$("chatView"))
    app.useSarahImage(app.$("authSarahImg"), app.$("authSarahFallback"))
    showForm(mode || "login")
  }

  function setBusy(form, busy) {
    var btn = form.querySelector("button[type=submit]")
    if (btn) btn.disabled = busy
  }

  function setError(formId, message) {
    var el = app.$(formId + "Error")
    if (el) el.textContent = message || ""
  }

  function setSuccess(formId, message) {
    var el = app.$(formId + "Success")
    if (el) el.textContent = message || ""
  }

  function enterChatWith(data) {
    app.state.user = data.user
    app.enterChat()
  }

  app.$("loginForm").addEventListener("submit", function (e) {
    e.preventDefault()
    var form = e.target
    setError("login", "")
    setBusy(form, true)

    app.api("/api/auth/login", {
      method: "POST",
      body: {
        email: app.$("loginEmail").value,
        password: app.$("loginPassword").value
      }
    }).then(function (data) {
      enterChatWith(data)
    }).catch(function (err) {
      setError("login", (err && err.error) || "حصلت مشكلة، حاول تاني.")
      setBusy(form, false)
    })
  })

  app.$("registerForm").addEventListener("submit", function (e) {
    e.preventDefault()
    var form = e.target
    setError("register", "")

    var password = app.$("regPassword").value
    var confirm = app.$("regConfirm").value

    if (password !== confirm) {
      setError("register", "الباسورد وتأكيده مش شبه بعض.")
      return
    }

    setBusy(form, true)

    app.api("/api/auth/register", {
      method: "POST",
      body: {
        fullName: app.$("regFullName").value,
        email: app.$("regEmail").value,
        password: password,
        confirmPassword: confirm
      }
    }).then(function (data) {
      enterChatWith(data)
    }).catch(function (err) {
      setError("register", (err && err.error) || "حصلت مشكلة، حاول تاني.")
      setBusy(form, false)
    })
  })

  app.$("forgotForm").addEventListener("submit", function (e) {
    e.preventDefault()
    var form = e.target
    setError("forgot", "")
    setSuccess("forgot", "")
    setBusy(form, true)

    var email = app.$("forgotEmail").value

    app.api("/api/auth/forgot-password", {
      method: "POST",
      body: { email: email }
    }).then(function () {
      setBusy(form, false)
      app.$("resetEmail").value = email
      app.$("resetCode").value = ""
      app.$("resetPassword").value = ""
      app.$("resetConfirm").value = ""
      showForm("reset")
      setSuccess("reset", "لو الإيميل مسجل عندنا، هتوصلك رسالة فيها كود التحقق.")
    }).catch(function (err) {
      setBusy(form, false)
      setError("forgot", (err && err.error) || "حصلت مشكلة، حاول تاني.")
    })
  })

  app.$("resetForm").addEventListener("submit", function (e) {
    e.preventDefault()
    var form = e.target
    setError("reset", "")
    setSuccess("reset", "")

    var newPassword = app.$("resetPassword").value
    var confirm = app.$("resetConfirm").value

    if (newPassword !== confirm) {
      setError("reset", "الباسورد وتأكيده مش شبه بعض.")
      return
    }

    setBusy(form, true)

    app.api("/api/auth/reset-password", {
      method: "POST",
      body: {
        email: app.$("resetEmail").value,
        code: app.$("resetCode").value,
        newPassword: newPassword
      }
    }).then(function () {
      setBusy(form, false)
      app.$("loginEmail").value = app.$("resetEmail").value
      app.$("loginPassword").value = ""
      showForm("login")
      setSuccess("login", "تم تغيير الباسورد بنجاح. سجل دخولك من هنا.")
    }).catch(function (err) {
      setBusy(form, false)
      setError("reset", (err && err.error) || "حصلت مشكلة، حاول تاني.")
    })
  })

  var linkButtons = document.querySelectorAll("[data-auth-target]")
  for (var i = 0; i < linkButtons.length; i++) {
    linkButtons[i].addEventListener("click", function () {
      var target = this.getAttribute("data-auth-target")
      showForm(target)
    })
  }
})()
