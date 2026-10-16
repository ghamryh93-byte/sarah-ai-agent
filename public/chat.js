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
  var attachBtn = app.$("attachBtn")
  var fileInput = app.$("fileInput")
  var attachPreviewEl = app.$("attachPreview")
  var attachNotesEl = app.$("attachNotes")

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

  function makeSvgIcon(path) {
    var span = document.createElement("span")
    span.setAttribute("aria-hidden", "true")
    span.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      path + "</svg>"
    return span.firstChild
  }

  var IMG_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/></svg>'
  var DOC_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>'
  var CLOSE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'

  function formatBytes(bytes) {
    if (!bytes) return ""
    if (bytes < 1024) return bytes + " B"
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB"
    return (bytes / (1024 * 1024)).toFixed(1) + " MB"
  }

  function openLightbox(src, alt) {
    var lb = document.createElement("div")
    lb.className = "lightbox"
    lb.setAttribute("role", "dialog")
    lb.setAttribute("aria-modal", "true")
    lb.setAttribute("aria-label", alt || "صورة مرفقة")

    var img = document.createElement("img")
    img.src = src
    img.alt = alt || ""

    var close = document.createElement("button")
    close.type = "button"
    close.className = "lightbox-close"
    close.setAttribute("aria-label", "إغلاق الصورة")
    close.appendChild(makeSvgIcon(CLOSE_ICON))

    function closeLb() {
      lb.remove()
      document.removeEventListener("keydown", onKey)
    }
    function onKey(e) {
      if (e.key === "Escape") closeLb()
    }

    lb.appendChild(img)
    lb.appendChild(close)
    lb.addEventListener("click", function (e) {
      if (e.target === lb || e.target === img) closeLb()
    })
    close.addEventListener("click", closeLb)
    document.addEventListener("keydown", onKey)
    document.body.appendChild(lb)
    close.focus()
  }

  function buildAttachmentMedia(attachments) {
    var media = document.createElement("div")
    media.className = "attach-media"

    for (var i = 0; i < attachments.length; i++) {
      var a = attachments[i]
      var holder = document.createElement("div")
      holder.className = "msg-attachment"

      if (a.type === "image" && a.url) {
        var img = document.createElement("img")
        img.src = a.url
        img.alt = a.name
        img.loading = "lazy"
        img.decoding = "async"
        img.className = "zoomable"
        var target = a.name
        img.addEventListener("click", function () {
          openLightbox(this.src, this.alt || target)
        })
        holder.appendChild(img)
      } else if (a.url) {
        var chip = document.createElement("a")
        chip.className = "file-chip"
        chip.href = a.url
        chip.target = "_blank"
        chip.rel = "noopener"
        if (a.name) chip.download = a.name
        chip.appendChild(makeSvgIcon(a.type === "image" ? IMG_ICON : DOC_ICON))
        var label = document.createElement("span")
        label.className = "attach-name"
        label.textContent = a.name
        chip.appendChild(label)
        if (a.size) {
          var size = document.createElement("span")
          size.className = "attach-size"
          size.textContent = formatBytes(a.size)
          chip.appendChild(size)
        }
        holder.appendChild(chip)
      }

      if (holder.firstChild) media.appendChild(holder)
    }

    return media
  }

  function addMessage(role, text, isHistory, attachments) {
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

    if (attachments && attachments.length) {
      bubble.appendChild(buildAttachmentMedia(attachments))
    }

    if (text) {
      bubble.appendChild(document.createTextNode(text))
    } else if (!attachments || !attachments.length) {
      bubble.textContent = ""
    }

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

  function showError(message, failedText, failedAttachments) {
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
      doSend(failedText, true, failedAttachments)
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

      var item = document.createElement("button")
      item.type = "button"
      item.className = "conv-item" + (conv.id === app.state.currentId ? " active" : "")
      item.setAttribute("data-id", conv.id)
      if (conv.id === app.state.currentId) {
        item.setAttribute("aria-current", "true")
      }

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
      del.setAttribute("aria-label", "حذف المحادثة: " + (conv.title || "محادثة"))
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
    if (listening) stopDictation()
    pendingAttachments = []
    renderAttachmentPreview()
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
        var m = conv.messages[i]
        addMessage(m.role, m.content, true, m.attachments)
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

  function doSend(text, isRetry, retryAttachments) {
    text = (text || "").trim()
    if (listening) stopDictation()

    var attachments = isRetry ? (retryAttachments || []) : pendingAttachments.slice()
    if ((!text && !attachments.length) || app.state.sending) return

    if (!isRetry) {
      addMessage("user", text, false, attachments)
      app.hide(welcomeEl)
      // Queue cleared: optimistic. On failure they are handed back to retry.
      pendingAttachments = []
      renderAttachmentPreview()
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
        body: {
          conversationId: conversationId,
          message: text,
          attachments: attachments
        }
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
      if (!isRetry && attachments.length) {
        pendingAttachments = attachments
        renderAttachmentPreview()
      }
      showError(
        (err && err.error) || "مش قادرة أوصل بالسيرفر دلوقتي. حاول تاني.",
        text,
        attachments
      )
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

  // ---------------------------------------------------------------------------
  // Attachments: select → validate → upload one-by-one → preview → send
  // ---------------------------------------------------------------------------
  var MAX_FILE_BYTES = 3 * 1024 * 1024
  var MAX_FILES_PER_MESSAGE = 3
  var ALLOWED_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain", "text/markdown"]
  var pendingAttachments = []

  function mimeOf(file) {
    var t = (file.type || "").toLowerCase()
    if (ALLOWED_MIMES.indexOf(t) !== -1) return t
    var name = file.name || ""
    if (/\.txt$/i.test(name)) return "text/plain"
    if (/\.md$/i.test(name)) return "text/markdown"
    if (/\.pdf$/i.test(name)) return "application/pdf"
    if (/\.png$/i.test(name)) return "image/png"
    if (/\.jpe?g$/i.test(name)) return "image/jpeg"
    if (/\.webp$/i.test(name)) return "image/webp"
    if (/\.gif$/i.test(name)) return "image/gif"
    return ""
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader()
      reader.addEventListener("load", function () {
        var result = String(reader.result || "")
        var comma = result.indexOf(",")
        resolve(comma === -1 ? result : result.slice(comma + 1))
      })
      reader.addEventListener("error", function () {
        reject(new Error("read failed"))
      })
      reader.readAsDataURL(file)
    })
  }

  function showTransientError(message) {
    if (!attachNotesEl) {
      console.warn("[sarah] attachment error:", message)
      return
    }
    var chip = document.createElement("div")
    chip.className = "attach-chip is-error"
    var label = document.createElement("span")
    label.textContent = message
    chip.appendChild(label)
    attachNotesEl.appendChild(chip)
    attachNotesEl.hidden = false
    setTimeout(function () {
      chip.remove()
      if (!attachNotesEl.childElementCount) attachNotesEl.hidden = true
    }, 8000)
  }

  function renderAttachmentPreview() {
    attachPreviewEl.innerHTML = ""

    for (var i = 0; i < pendingAttachments.length; i++) {
      var a = pendingAttachments[i]

      var chip = document.createElement("div")
      chip.className = "attach-chip"

      var label = document.createElement("span")
      label.className = "attach-name"
      label.textContent = a.name
      chip.appendChild(label)

      if (a.size) {
        var size = document.createElement("span")
        size.className = "attach-size"
        size.textContent = formatBytes(a.size)
        chip.appendChild(size)
      }

      var rm = document.createElement("button")
      rm.type = "button"
      rm.className = "rm"
      rm.setAttribute("aria-label", "إزالة المرفق " + a.name)
      rm.appendChild(makeSvgIcon(CLOSE_ICON))
      ;(function (meta) {
        rm.addEventListener("click", function () {
          pendingAttachments = pendingAttachments.filter(function (p) {
            return p !== meta
          })
          renderAttachmentPreview()
        })
      })(a)
      chip.appendChild(rm)

      attachPreviewEl.appendChild(chip)
    }

    if (pendingAttachments.length) {
      attachPreviewEl.hidden = false
    } else {
      attachPreviewEl.hidden = true
    }
  }

  function validateFile(file) {
    if (!file || !file.size) return "الملف فاضي أو مش مقروء."
    if (file.size > MAX_FILE_BYTES) return "الملف أكبر من 3MB: " + (file.name || "")
    if (pendingAttachments.length >= MAX_FILES_PER_MESSAGE) return "الحد الأقصى " + MAX_FILES_PER_MESSAGE + " مرفقات للرسالة."
    return ""
  }

  function uploadNext(files, index, done) {
    if (index >= files.length) {
      done()
      return
    }
    var file = files[index]
    var pendingError = validateFile(file)
    if (pendingError) {
      showTransientError(pendingError)
      uploadNext(files, index + 1, done)
      return
    }

    var mime = mimeOf(file)
    if (!mime) {
      showTransientError("صيغة مش مدعومة: " + (file.name || ""))
      uploadNext(files, index + 1, done)
      return
    }

    var chip = document.createElement("div")
    chip.className = "attach-chip"
    chip.setAttribute("aria-busy", "true")
    var label = document.createElement("span")
    label.className = "attach-name"
    label.textContent = (file.name || "جاري الرفع") + " …"
    chip.appendChild(label)
    attachPreviewEl.appendChild(chip)
    attachPreviewEl.hidden = false

    readFileAsBase64(file).then(function (base64) {
      return app.api("/api/upload", {
        method: "POST",
        body: { name: file.name || "file", mime: mime, data: base64 }
      })
    }).then(function (data) {
      chip.remove()
      if (data && data.attachment) {
        pendingAttachments.push(data.attachment)
      }
      renderAttachmentPreview()
      uploadNext(files, index + 1, done)
    }).catch(function (err) {
      chip.remove()
      showTransientError((err && err.error) || "فشل رفع الملف: " + (file.name || ""))
      renderAttachmentPreview()
      uploadNext(files, index + 1, done)
    })
  }

  attachBtn.addEventListener("click", function () {
    if (!app.state.sending) fileInput.click()
  })

  fileInput.addEventListener("change", function () {
    var files = Array.prototype.slice.call(fileInput.files || [])
    fileInput.value = ""
    if (files.length) uploadNext(files, 0, renderAttachmentPreview)
  })

  document.addEventListener("paste", function (e) {
    if (app.state.sending || !chatAreaEl) return
    var items = (e.clipboardData && e.clipboardData.files) || []
    if (items.length) {
      e.preventDefault()
      uploadNext(Array.prototype.slice.call(items), 0, renderAttachmentPreview)
    }
  })

  // ---------------------------------------------------------------------------
  // Voice input (Web Speech API — dictation into the composer)
  // ---------------------------------------------------------------------------
  var micBtn = app.$("micBtn")
  var recognition = null
  var listening = false
  var dictationBase = ""
  var dictationFinal = ""

  function stopDictation() {
    listening = false
    if (recognition) {
      try {
        recognition.abort()
      } catch (e) {}
    }
    if (micBtn) {
      micBtn.classList.remove("is-listening")
      micBtn.setAttribute("aria-pressed", "false")
    }
  }

  if (micBtn) {
    var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) {
      micBtn.hidden = true
    } else {
      micBtn.hidden = false
      recognition = new SpeechRecognitionCtor()
      recognition.lang = "ar-EG"
      recognition.continuous = true
      recognition.interimResults = true
      recognition.maxAlternatives = 1

      recognition.onresult = function (event) {
        var interim = ""
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var phrase = event.results[i][0].transcript
          if (event.results[i].isFinal) {
            dictationFinal += phrase.trim() + " "
          } else {
            interim += phrase
          }
        }
        inputEl.value = (dictationBase + dictationFinal + interim).replace(/\s+$/, " ")
        autoGrow()
      }

      recognition.onerror = function (event) {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          showTransientError("صلاحية المايك مش مفعلة. اسمح ليها من المتصفح وجرب تاني.")
        } else if (event.error === "network") {
          showTransientError("صوت مش واصل. اتأكد من النت وجرب تاني.")
        }
        // "no-speech" and "aborted" are normal — just fall through
        stopDictation()
      }

      recognition.onend = function () {
        // Browsers stop after silence; reflect the real state.
        if (listening) stopDictation()
      }

      micBtn.addEventListener("click", function () {
        if (app.state.sending) return
        if (listening) {
          stopDictation()
          return
        }
        dictationBase = inputEl.value ? inputEl.value.replace(/\s*$/, "") + " " : ""
        dictationFinal = ""
        listening = true
        micBtn.classList.add("is-listening")
        micBtn.setAttribute("aria-pressed", "true")
        try {
          recognition.start()
        } catch (e) {
          stopDictation()
        }
      })
    }
  }

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

    var isAdmin = Boolean(app.state.user && app.state.user.isAdmin)
    var adminEls = [app.$("adminDashboardLink"), app.$("sidebarAdminBtn"), app.$("headerAdminBtn")]
    adminEls.forEach(function (el) {
      if (el) {
        if (isAdmin) app.show(el)
        else app.hide(el)
      }
    })

    app.useSarahImage(app.$("sidebarSarahImg"), app.$("sidebarSarahFallback"))
    app.useSarahImage(app.$("welcomeSarahImg"), app.$("welcomeSarahFallback"))

    newChat(false)
    refreshList()
  }

  app.boot()
})()
