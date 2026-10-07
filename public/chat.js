(function () {
  "use strict"

  var app = window.SarahApp

  var messagesEl = app.$("messages")
  var welcomeEl = app.$("welcome")
  var inputEl = app.$("messageInput")
  var sendBtn = app.$("sendBtn")
  var chatAreaEl = app.$("chatArea")
  var chatTitleEl = app.$("chatTitle")
  var listEl = app.$("conversationList")
  var sidebarEl = app.$("sidebar")
  var overlayEl = app.$("sidebarOverlay")

  var typingEl = null

  function scrollBottom() {
    chatAreaEl.scrollTop = chatAreaEl.scrollHeight
  }

  function setHeaderTitle(title) {
    chatTitleEl.textContent = title || "سارة"
  }

  function openSidebar() {
    sidebarEl.classList.add("open")
    app.show(overlayEl)
  }

  function closeSidebar() {
    sidebarEl.classList.remove("open")
    app.hide(overlayEl)
  }

  function addMessage(role, text, isHistory) {
    var wrap = document.createElement("div")
    wrap.className = "msg " + (role === "user" ? "msg-user" : "msg-sarah")

    if (role !== "user") {
      var avatar = document.createElement("div")
      avatar.className = "avatar-fallback msg-avatar"
      avatar.textContent = "س"
      wrap.appendChild(avatar)
    }

    var bubble = document.createElement("div")
    bubble.className = "bubble"
    bubble.dir = "auto"
    bubble.textContent = text

    wrap.appendChild(bubble)
    messagesEl.appendChild(wrap)

    if (!isHistory) scrollBottom()
  }

  function showTyping() {
    typingEl = document.createElement("div")
    typingEl.className = "msg msg-sarah"

    var avatar = document.createElement("div")
    avatar.className = "avatar-fallback msg-avatar"
    avatar.textContent = "س"

    var bubble = document.createElement("div")
    bubble.className = "bubble typing"
    bubble.appendChild(document.createElement("span"))
    bubble.appendChild(document.createElement("span"))
    bubble.appendChild(document.createElement("span"))

    typingEl.appendChild(avatar)
    typingEl.appendChild(bubble)
    messagesEl.appendChild(typingEl)
    scrollBottom()
  }

  function hideTyping() {
    if (typingEl) {
      typingEl.remove()
      typingEl = null
    }
  }

  function hideError() {
    var el = app.$("errorMsg")
    if (el) el.remove()
  }

  function showError(message, failedText) {
    hideError()

    var wrap = document.createElement("div")
    wrap.className = "msg msg-sarah"
    wrap.id = "errorMsg"

    var bubble = document.createElement("div")
    bubble.className = "bubble bubble-error"
    bubble.dir = "auto"

    var msg = document.createElement("div")
    msg.textContent = message

    var retry = document.createElement("button")
    retry.type = "button"
    retry.className = "retry-btn"
    retry.textContent = "حاول تاني"
    retry.addEventListener("click", function () {
      hideError()
      doSend(failedText, true)
    })

    bubble.appendChild(msg)
    bubble.appendChild(retry)
    wrap.appendChild(bubble)
    messagesEl.appendChild(wrap)
    scrollBottom()
  }

  function formatListDate(iso) {
    try {
      var date = new Date(iso)
      var now = new Date()
      var isToday = date.toDateString() === now.toDateString()
      if (isToday) {
        return date.toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" })
      }
      return date.toLocaleDateString("ar-EG", { day: "numeric", month: "short" })
    } catch (e) {
      return ""
    }
  }

  function renderList() {
    listEl.innerHTML = ""

    if (!app.state.conversations.length) {
      var empty = document.createElement("div")
      empty.className = "conv-empty"
      empty.textContent = "لسه مفيش محادثات.\nابدأ أول محادثة مع سارة 🤍"
      listEl.appendChild(empty)
      return
    }

    for (var i = 0; i < app.state.conversations.length; i++) {
      var conv = app.state.conversations[i]

      var item = document.createElement("div")
      item.className = "conv-item" + (conv.id === app.state.currentId ? " active" : "")
      item.setAttribute("data-id", conv.id)

      var title = document.createElement("div")
      title.className = "conv-title"
      title.dir = "auto"
      title.textContent = conv.title || "محادثة"

      var date = document.createElement("div")
      date.className = "conv-date"
      date.dir = "ltr"
      date.textContent = formatListDate(conv.updatedAt)

      var del = document.createElement("button")
      del.type = "button"
      del.className = "conv-delete"
      del.title = "حذف المحادثة"
      del.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'

      del.addEventListener("click", function (e) {
        e.stopPropagation()
        var id = this.parentElement.getAttribute("data-id")
        if (window.confirm("تحب تحذف المحادثة دي؟")) {
          app.api("/api/conversations/" + encodeURIComponent(id), { method: "DELETE" }).then(function () {
            if (app.state.currentId === id) {
              newChat(false)
            }
            refreshList()
          }).catch(function () {})
        }
      })

      item.appendChild(title)
      item.appendChild(date)
      item.appendChild(del)

      item.addEventListener("click", function () {
        openConversation(this.getAttribute("data-id"))
      })

      listEl.appendChild(item)
    }
  }

  function refreshList() {
    return app.api("/api/conversations").then(function (data) {
      app.state.conversations = data.conversations || []
      renderList()
    }).catch(function () {})
  }

  function newChat(closeDrawer) {
    app.state.currentId = null
    app.state.currentTitle = ""
    messagesEl.innerHTML = ""
    hideError()
    app.show(welcomeEl)
    setHeaderTitle("سارة")
    renderList()
    if (closeDrawer) closeSidebar()
    if (window.innerWidth > 900) inputEl.focus()
  }

  function openConversation(id) {
    app.api("/api/conversations/" + encodeURIComponent(id)).then(function (data) {
      var conv = data.conversation
      app.state.currentId = conv.id
      app.state.currentTitle = conv.title

      messagesEl.innerHTML = ""
      hideError()
      app.hide(welcomeEl)

      for (var i = 0; i < conv.messages.length; i++) {
        addMessage(conv.messages[i].role, conv.messages[i].content, true)
      }

      setHeaderTitle(conv.title)
      renderList()
      closeSidebar()
      scrollBottom()
      if (window.innerWidth > 900) inputEl.focus()
    }).catch(function (err) {
      showError((err && err.error) || "مش قادرة أفتح المحادثة دي.", null)
    })
  }

  function doSend(text, isRetry) {
    text = (text || "").trim()
    if (!text || app.state.sending) return

    if (!isRetry) {
      addMessage("user", text)
      app.hide(welcomeEl)
    }

    app.state.sending = true
    sendBtn.disabled = true
    showTyping()

    var prepare

    if (app.state.currentId) {
      prepare = Promise.resolve(app.state.currentId)
    } else {
      prepare = app.api("/api/conversations", { method: "POST" }).then(function (data) {
        app.state.currentId = data.conversation.id
        return data.conversation.id
      })
    }

    prepare.then(function (conversationId) {
      return app.api("/api/chat", {
        method: "POST",
        body: { conversationId: conversationId, message: text }
      })
    }).then(function (data) {
      hideTyping()
      addMessage("assistant", data.reply)
      app.state.currentTitle = data.title || app.state.currentTitle
      setHeaderTitle(app.state.currentTitle)
      app.state.sending = false
      sendBtn.disabled = false
      refreshList()
    }).catch(function (err) {
      hideTyping()
      app.state.sending = false
      sendBtn.disabled = false
      showError((err && err.error) || "مش قادرة أوصل بالسيرفر دلوقتي. حاول تاني.", text)
    })

    if (!isRetry) {
      inputEl.value = ""
      autoGrow()
    }
  }

  function autoGrow() {
    inputEl.style.height = "auto"
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px"
  }

  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      doSend(inputEl.value, false)
    }
  })

  inputEl.addEventListener("input", autoGrow)

  sendBtn.addEventListener("click", function () {
    doSend(inputEl.value, false)
  })

  var chips = document.querySelectorAll(".chip")
  for (var i = 0; i < chips.length; i++) {
    chips[i].addEventListener("click", function () {
      doSend(this.getAttribute("data-msg"), false)
    })
  }

  app.$("newChatBtn").addEventListener("click", function () {
    newChat(true)
  })

  app.$("menuBtn").addEventListener("click", openSidebar)
  app.$("closeSidebarBtn").addEventListener("click", closeSidebar)
  overlayEl.addEventListener("click", closeSidebar)

  app.$("logoutBtn").addEventListener("click", function () {
    app.api("/api/auth/logout", { method: "POST", body: {} }).catch(function () {}).then(function () {
      app.state.user = null
      app.state.conversations = []
      app.state.currentId = null
      app.state.currentTitle = ""
      closeSidebar()
      app.enterAuth("login")
    })
  })

  app.enterChat = function () {
    app.hide(app.$("authView"))
    app.show(app.$("chatView"))

    app.$("userName").textContent = app.state.user.fullName
    app.$("userEmail").textContent = app.state.user.email

    app.useSarahImage(app.$("sidebarSarahImg"), app.$("sidebarSarahFallback"))
    app.useSarahImage(app.$("welcomeSarahImg"), app.$("welcomeSarahFallback"))

    newChat(false)
    refreshList()
  }

  app.boot()
})()
