import QtQuick
import QtQuick.Layouts
import Quickshell
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "lib/sim.js" as Sim
import "lib/draw.js" as Draw

// The bar icon and its panel. Click for the panel, right-click to turn the
// weather on or off, scroll to change it.
//
// The panel: a hero with the master switch, a live preview of the effect
// (the real simulation, small, running only while the panel is open), then
// three views: Scene (the effect, its amount, the big switches for what
// lives on the desktop, and quick actions), World (seasons, weather, the
// finer switches) and Friends.
BarWidget {
  id: root
  moduleName: "itscallssh.flurry"

  readonly property var service: bar && bar.shell && typeof bar.shell.serviceFor === "function"
    ? bar.shell.serviceFor(moduleName) : null
  readonly property bool on: !!service && service.isOn
  readonly property string effect: service ? service.effect : "snow"
  readonly property var saved: service ? service.saved : ({})

  Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  // Material Design glyphs from the Nerd Font every Omarchy theme uses.
  readonly property var glyphs: ({
    snow: 0xF0598, leaves: 0xF032A, starfall: 0xF0594, rain: 0xF0596, sakura: 0xF024A, fireflies: 0xF06E8,
    plow: 0xF0B22, snowball: 0xF0717, sleigh: 0xF04B7, rabbit: 0xF0907, decorate: 0xF0405, shake: 0xF0566,
    freeze: 0xF0F2A, windGusts: 0xF059D, throwToFriends: 0xF0717, writing: 0xF0F49, dayCycle: 0xF12CB, seasons: 0xF0E66, newYear: 0xF0E30,
    themeSync: 0xF03D8, battery: 0xF1211, liveWeather: 0xF050F, calm: 0xF04B2, friends: 0xF000E, copy: 0xF018F,
    paste: 0xF014A, send: 0xF048A, remove: 0xF0156, baubles: 0xF03CF, gift: 0xF0E44,
    sound: 0xF057E, soundOff: 0xF0581
  })
  function glyph(name) { return String.fromCodePoint(glyphs[name] || 0xF0598) }
  function effectName(name) { return strings.t("effect." + name) }

  property bool popupOpen: false
  property string view: "scene"
  property string actionNote: ""
  property string friendNote: ""
  property var hare: ({ here: false, why: "" })
  // The shell opens and closes the panel through these (a hotkey,
  // `omarchy-shell shell toggle itscallssh.flurry`): Bar.findPanelWidget
  // needs open, close and opened on the widget's root.
  readonly property bool opened: popupOpen
  function open() { popupOpen = true }
  function close() { popupOpen = false }
  // Why a visitor can't come, in the panel's language. The service gives the
  // reason in English (as `flurry diag` does); a reason with no string here
  // is shown as it came.
  readonly property var whyKeys: ({
    "surprises are off": "why.surprisesOff", "calm mode": "why.calm", "a fullscreen app is up": "why.fullscreen",
    "battery is low": "why.lowBattery", "decorating": "why.decorating", "a window is moving": "why.dragging",
    "the plow is out": "why.plow", "no sprouts up yet": "why.noSprouts", "no snow on the ground yet": "why.noGroundSnow",
    "Flurry is off": "why.off", "no screen": "why.noScreen", "no scene": "why.noScreen"
  })
  function whyText(why) {
    why = String(why || "")
    if (whyKeys[why]) return strings.t(whyKeys[why])
    if (why.indexOf("the hare comes only in snow") === 0) return strings.t("why.onlySnow")
    return why
  }
  function refreshHare() { if (root.service) root.hare = root.service.visitorStatus("rabbit") }
  onPopupOpenChanged: { if (popupOpen) { root.actionNote = ""; root.friendNote = ""; refreshHare() } }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.glyph(root.effect)
    dimmed: !root.on
    active: root.popupOpen
    tooltipText: root.on ? strings.t("tooltip.on").arg(root.effectName(root.effect)) : strings.t("tooltip.off")
    onPressed: function(b) {
      if (!root.service) return
      if (b === Qt.RightButton) root.service.toggle()
      else root.popupOpen = !root.popupOpen
    }
    onWheelMoved: function(delta) { if (root.service) root.service.nextEffect(delta > 0 ? -1 : 1) }
  }

  // While the panel is open: whether the hare is here or why not, every
  // couple of seconds (it reads the scene's snow, so it changes slowly).
  Timer {
    interval: 2000
    repeat: true
    running: root.popupOpen && !!root.service
    onTriggered: root.refreshHare()
  }

  // ------------------------------------------------------------ pieces

  component PlainText: Text {
    textFormat: Text.PlainText
    color: Commons.Color.popups.text
    font.family: Style.font.family
    font.pixelSize: Style.font.body
  }

  // One effect: a big glyph over its name; the chosen one is filled.
  component EffectTile: Item {
    id: tile
    property string name: ""
    property bool selected: false
    signal picked()
    Layout.fillWidth: true
    implicitHeight: Style.space(64)

    Rectangle {
      anchors.fill: parent
      radius: Style.cornerRadius
      color: tile.selected ? Style.selectedFillFor(Commons.Color.popups.text, Commons.Color.accent)
        : (tileMouse.containsMouse ? Style.hoverFillFor(Commons.Color.popups.text, Commons.Color.accent) : "transparent")
      Behavior on color { ColorAnimation { duration: Style.duration(120); easing.type: Easing.OutCubic } }
    }
    Column {
      anchors.centerIn: parent
      spacing: Style.space(4)
      PlainText {
        anchors.horizontalCenter: parent.horizontalCenter
        text: root.glyph(tile.name)
        font.pixelSize: Style.font.display
        opacity: tile.selected ? 1 : 0.75
      }
      PlainText {
        anchors.horizontalCenter: parent.horizontalCenter
        text: root.effectName(tile.name)
        font.pixelSize: Style.font.caption
        font.bold: tile.selected
        opacity: tile.selected ? 1 : 0.7
      }
    }
    MouseArea {
      id: tileMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: tile.picked()
    }
  }

  // A big switch: icon, title, a line about it, and the toggle. The whole
  // card is the hit area. `note` adds a status line in the accent colour.
  component FeatureCard: BorderSurface {
    id: card
    property string icon: ""
    property string title: ""
    property string description: ""
    property string note: ""
    property bool checked: false
    signal toggled()
    Layout.fillWidth: true
    implicitHeight: cardRow.implicitHeight + Style.space(24)
    radius: Style.cornerRadius
    color: cardMouse.containsMouse ? Style.hoverFillFor(Commons.Color.popups.text, Commons.Color.accent) : "transparent"
    borderSpec: Border.controlSpec(cardMouse.containsMouse ? "hover-cursor" : "normal", Commons.Color.popups.text, Commons.Color.accent)

    MouseArea {
      id: cardMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: card.toggled()
    }
    RowLayout {
      id: cardRow
      anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; leftMargin: Style.space(14); rightMargin: Style.space(10) }
      spacing: Style.space(12)
      PlainText {
        Layout.alignment: Qt.AlignVCenter
        Layout.preferredWidth: Style.space(24)
        horizontalAlignment: Text.AlignHCenter
        text: card.icon
        font.pixelSize: Style.font.iconLarge
        opacity: card.checked ? 1 : 0.5
      }
      ColumnLayout {
        Layout.fillWidth: true
        spacing: Style.space(2)
        PlainText {
          Layout.fillWidth: true
          text: card.title
          font.pixelSize: Style.font.subtitle
          font.bold: true
          elide: Text.ElideRight
        }
        PlainText {
          Layout.fillWidth: true
          visible: text !== ""
          text: card.description
          font.pixelSize: Style.font.caption
          wrapMode: Text.Wrap
          opacity: 0.65
        }
        PlainText {
          Layout.fillWidth: true
          visible: text !== ""
          text: card.note
          color: Commons.Color.accent
          font.pixelSize: Style.font.caption
          wrapMode: Text.Wrap
        }
      }
      ToggleSwitch {
        Layout.alignment: Qt.AlignVCenter
        checked: card.checked
        onToggled: card.toggled()
      }
    }
  }

  component FlagCard: FeatureCard {
    property string flag: ""
    icon: root.glyph(flag)
    title: strings.t("flag." + flag)
    description: strings.t("flag." + flag + ".desc")
    checked: !!root.saved[flag]
    onToggled: root.service.setFlag(flag, !root.saved[flag])
  }

  component ActionButton: Button {
    Layout.fillWidth: true
    bordered: true
  }

  // ------------------------------------------------------------ panel

  PopupCard {
    id: popup
    anchorItem: root
    bar: root.bar
    owner: root
    open: root.popupOpen
    contentWidth: popup.fittedContentWidth(Style.space(380))
    contentHeight: popup.fittedContentHeight(root.service ? body.implicitHeight : missingNote.implicitHeight)

    PlainText {
      id: missingNote
      anchors.centerIn: parent
      width: popup.contentWidth
      visible: !root.service
      text: strings.t("service.unavailable")
      wrapMode: Text.Wrap
      opacity: 0.8
    }

    Flickable {
      id: flick
      anchors.fill: parent
      visible: !!root.service
      focus: root.popupOpen
      Keys.onEscapePressed: root.close()
      contentWidth: width
      contentHeight: body.implicitHeight
      clip: contentHeight > height
      interactive: contentHeight > height
      boundsBehavior: Flickable.StopAtBounds

      ColumnLayout {
        id: body
        width: flick.width
        spacing: Style.spacing.panelGap

        // -------------------------------------------------- hero
        PanelHero {
          Layout.fillWidth: true
          foreground: Commons.Color.popups.text
          title: "Flurry"
          meta: !root.on ? strings.t("status.off")
            : (root.service && root.service.calmActive ? strings.t("status.calm").arg(root.effectName(root.effect))
                                                        : strings.t("status.on").arg(root.effectName(root.effect)))
          iconComponent: Component {
            PlainText { text: root.glyph(root.effect); font.pixelSize: Style.font.display; opacity: root.on ? 1 : 0.5 }
          }
          trailingControl: Component {
            ToggleSwitch { checked: root.on; onToggled: root.service.toggle() }
          }
        }

        // -------------------------------------------------- preview
        BorderSurface {
          id: previewBox
          Layout.fillWidth: true
          implicitHeight: Style.space(112)
          radius: Style.cornerRadius
          clip: true
          color: Qt.darker(Commons.Color.popups.background, 1.25)
          borderSpec: Border.controlSpec("normal", Commons.Color.popups.text, Commons.Color.accent)

          readonly property bool running: root.popupOpen && root.on
          property var world: null
          // The little window the snow lands on, in the preview's frame.
          readonly property var win: ({ id: "preview", x: Math.round(previewBox.width * 0.18), y: Math.round(previewBox.height * 0.38),
                                        w: Math.round(previewBox.width * 0.46), h: Math.round(previewBox.height * 0.62), floating: true, z: 0 })
          property real age: 0

          function rebuild() {
            if (previewBox.width < 40 || previewBox.height < 40) return
            var w = Sim.createWorld(previewBox.width, previewBox.height, { effect: root.effect, intensity: Math.max(0.6, root.service ? root.service.intensity : 1), plow: false })
            if (root.service) Sim.setEnv(w, root.service.env)
            // It opens on a scene that has been snowing a while.
            var g = w.surfaces[Sim.GROUND_ID]
            if (g && root.effect === "snow") for (var i = 0; i < g.bins.length; i++) g.bins[i] = 5 + 1.5 * Math.sin(i * 0.35)
            previewBox.world = w
            previewBox.age = 0
            previewCanvas.requestPaint()
          }
          onWidthChanged: if (previewBox.running) previewBox.rebuild()
          onRunningChanged: { if (previewBox.running) previewBox.rebuild(); else previewBox.world = null }
          Connections {
            target: root
            function onEffectChanged() { if (previewBox.running) previewBox.rebuild() }
          }

          // The window: its face shows through where the canvas clears it.
          Rectangle {
            x: previewBox.win.x; y: previewBox.win.y; width: previewBox.win.w; height: previewBox.win.h
            radius: Style.cornerRadius
            color: Commons.Color.popups.background
            border.width: 1
            border.color: Qt.rgba(Commons.Color.popups.text.r, Commons.Color.popups.text.g, Commons.Color.popups.text.b, 0.25)
            Column {
              x: Style.space(8); y: Style.space(8)
              spacing: Style.space(5)
              Repeater {
                model: [0.7, 0.45, 0.6]
                delegate: Rectangle {
                  required property real modelData
                  width: previewBox.win.w * modelData; height: Style.space(3); radius: height / 2
                  color: Qt.rgba(Commons.Color.popups.text.r, Commons.Color.popups.text.g, Commons.Color.popups.text.b, 0.18)
                }
              }
            }
          }

          Canvas {
            id: previewCanvas
            anchors.fill: parent
            visible: previewBox.running && !!previewBox.world
            renderTarget: Canvas.FramebufferObject
            renderStrategy: Canvas.Cooperative
            onPaint: {
              if (!previewBox.world) return
              var ctx = getContext("2d")
              ctx.reset()
              try { Draw.world(ctx, previewBox.world) } catch (e) { }
            }
          }

          FrameAnimation {
            running: previewBox.running && !!previewBox.world
            onTriggered: {
              var w = previewBox.world
              var dt = Math.min(Math.max(frameTime, 0), 0.05)
              previewBox.age += dt
              Sim.setSurfaces(w, [previewBox.win], w.time)
              // The hare pays the preview a visit when it would come to the
              // desktop, so you can see it is there.
              if (root.effect === "snow" && root.saved.surprises && !w.rabbit && previewBox.age > 2.5 && previewBox.age < 3)
                Sim.spawnRabbit(w, { force: true })
              try { Sim.step(w, dt, { pointer: null }) } catch (e) { }
              previewCanvas.requestPaint()
            }
          }

          PlainText {
            anchors.centerIn: parent
            visible: !previewBox.running
            text: strings.t("preview.off")
            opacity: 0.6
            font.pixelSize: Style.font.caption
          }
        }

        ButtonGroup {
          Layout.fillWidth: true
          options: [{ value: "scene", label: strings.t("view.scene") },
                    { value: "world", label: strings.t("view.world") },
                    { value: "friends", label: strings.t("view.friends") }]
          value: root.view
          onChanged: function(v) { root.view = v; flick.contentY = 0 }
        }

        // ================================================== Scene
        ColumnLayout {
          Layout.fillWidth: true
          visible: root.view === "scene"
          spacing: Style.spacing.panelGap

          PanelSectionHeader { text: strings.t("section.effect").toUpperCase(); foreground: Commons.Color.popups.text }
          GridLayout {
            Layout.fillWidth: true
            columns: 3
            rowSpacing: Style.space(4)
            columnSpacing: Style.space(4)
            Repeater {
              model: root.service ? root.service.effects : []
              delegate: EffectTile {
                required property string modelData
                name: modelData
                selected: root.on && root.effect === modelData
                onPicked: root.service.setEffect(modelData)
              }
            }
          }

          RowLayout {
            Layout.fillWidth: true
            PlainText { Layout.fillWidth: true; text: strings.t("amount"); font.pixelSize: Style.font.subtitle; font.bold: true }
            PlainText { text: Commons.I18n.formatNumber(amountSlider.liveValue, 2) + "×"; opacity: 0.7 }
          }
          PanelSlider {
            id: amountSlider
            Layout.fillWidth: true
            bar: root.bar
            minimum: 0.25
            maximum: 2
            step: 0.25
            value: root.service ? root.service.intensity : 1
            onReleased: function(v) { root.service.setIntensity(v) }
          }

          // Each effect's own sounds; off here for anyone who would rather
          // have silence.
          FeatureCard {
            icon: root.glyph(root.saved.sound ? "sound" : "soundOff")
            title: strings.t("sound")
            description: strings.t("sound.desc")
            checked: !!root.saved.sound
            onToggled: root.service.setSound(!root.saved.sound)
          }
          RowLayout {
            Layout.fillWidth: true
            visible: !!root.saved.sound
            PlainText { Layout.fillWidth: true; text: strings.t("sound.volume"); font.pixelSize: Style.font.subtitle; font.bold: true }
            PlainText { text: Commons.I18n.formatNumber(Math.round(volumeSlider.liveValue * 100), 0) + "%"; opacity: 0.7 }
          }
          PanelSlider {
            id: volumeSlider
            Layout.fillWidth: true
            visible: !!root.saved.sound
            bar: root.bar
            minimum: 0
            maximum: 1
            step: 0.05
            value: root.saved.soundVolume === undefined ? 0.8 : root.saved.soundVolume
            onReleased: function(v) { root.service.setSoundVolume(v) }
          }

          PanelSectionHeader { text: strings.t("section.desktop").toUpperCase(); foreground: Commons.Color.popups.text }

          FeatureCard {
            icon: root.glyph("plow")
            title: strings.t("plow")
            description: root.saved.plow ? strings.t("plow.desc.on") : strings.t("plow.desc.off")
            checked: !!root.saved.plow
            onToggled: root.service.setPlow(!root.saved.plow)
          }
          FeatureCard {
            icon: root.glyph("snowball")
            title: strings.t("snowballs")
            description: strings.t("snowballs.desc")
            checked: !!root.saved.snowballs
            onToggled: root.service.setSnowballs(!root.saved.snowballs)
          }
          FeatureCard {
            icon: root.glyph("sleigh")
            title: strings.t("visitors")
            description: strings.t("visitors.desc")
            checked: !!root.saved.visitors
            onToggled: root.service.setVisitors(!root.saved.visitors)
          }
          FeatureCard {
            icon: root.glyph("rabbit")
            title: strings.t("surprises")
            description: strings.t("surprises.desc")
            note: !root.saved.surprises || !root.on ? ""
              : (root.hare.here ? strings.t("hare.here") : (root.hare.why ? strings.t("hare.waiting").arg(root.whyText(root.hare.why)) : strings.t("hare.can")))
            checked: !!root.saved.surprises
            onToggled: root.service.setFlag("surprises", !root.saved.surprises)
          }

          PanelSectionHeader { text: strings.t("section.actions").toUpperCase(); foreground: Commons.Color.popups.text }
          GridLayout {
            Layout.fillWidth: true
            columns: 3
            rowSpacing: Style.space(6)
            columnSpacing: Style.space(6)
            ActionButton {
              iconText: root.glyph("decorate"); text: strings.t("action.decorate")
              onClicked: { root.close(); root.service.startDecorating() }
            }
            ActionButton {
              iconText: root.glyph("shake"); text: strings.t("action.shake")
              enabled: root.on && !!root.saved.shake
              onClicked: { root.close(); root.service.shakeAll() }
            }
            ActionButton {
              iconText: root.glyph("plow"); text: strings.t("action.plow")
              enabled: root.on && !!root.saved.plow
              tooltipText: root.saved.plow ? strings.t("action.plow.tip") : strings.t("plow.desc.off")
              onClicked: root.actionNote = root.service.summonPlow()
            }
            ActionButton {
              iconText: root.glyph("sleigh"); text: strings.t("action.santa")
              enabled: root.on
              onClicked: { root.close(); root.service.summonSanta() }
            }
            ActionButton {
              iconText: root.glyph("rabbit"); text: strings.t("action.hare")
              enabled: root.on
              tooltipText: strings.t("action.hare.tip")
              onClicked: { root.actionNote = root.service.surpriseNow("rabbit"); root.refreshHare() }
            }
            ActionButton {
              iconText: root.glyph("freeze"); text: strings.t("action.freeze")
              enabled: root.on
              onClicked: root.actionNote = root.service.freezeNow()
            }
          }
          PlainText {
            Layout.fillWidth: true
            visible: root.actionNote !== ""
            text: root.actionNote
            font.pixelSize: Style.font.caption
            wrapMode: Text.Wrap
            opacity: 0.7
          }
        }

        // ================================================== World
        ColumnLayout {
          Layout.fillWidth: true
          visible: root.view === "world"
          spacing: Style.spacing.panelGap

          PanelSectionHeader { text: strings.t("section.weather").toUpperCase(); foreground: Commons.Color.popups.text }
          FlagCard {
            flag: "liveWeather"
            note: root.saved.liveWeather && root.saved.weatherPlace ? root.saved.weatherPlace : ""
          }
          TextField {
            Layout.fillWidth: true
            visible: !!root.saved.liveWeather
            placeholderText: strings.t("city.placeholder")
            maximumLength: 80
            onAccepted: { if (text.trim() !== "") { root.service.setWeatherCity(text); text = "" } }
          }
          PlainText {
            Layout.fillWidth: true
            visible: !!root.saved.liveWeather && !!root.service
                     && (root.service.weatherStatus === "loading" || root.service.weatherStatus === "not_found" || root.service.weatherStatus === "error")
            text: !root.service ? ""
              : (root.service.weatherStatus === "loading" ? strings.t("weather.searching").arg(root.saved.weatherPlace || root.saved.weatherCity || "Open-Meteo")
              : (root.service.weatherStatus === "not_found" ? strings.t("weather.notFound").arg(root.service.missingCity || root.saved.weatherCity || "")
              : strings.t("weather.error")))
            font.pixelSize: Style.font.caption
            wrapMode: Text.Wrap
            opacity: 0.75
          }
          FlagCard { flag: "dayCycle" }
          FlagCard { flag: "windGusts" }

          PanelSectionHeader { text: strings.t("section.seasons").toUpperCase(); foreground: Commons.Color.popups.text }
          FlagCard { flag: "seasons" }
          FlagCard { flag: "newYear" }

          PanelSectionHeader { text: strings.t("section.more").toUpperCase(); foreground: Commons.Color.popups.text }
          FlagCard { flag: "writing" }
          FlagCard { flag: "themeSync" }
          FeatureCard {
            icon: root.glyph("battery")
            title: strings.t("battery")
            description: strings.t("battery.desc")
            checked: !!root.saved.batterySaver
            onToggled: root.service.setBatterySaver(!root.saved.batterySaver)
          }

          RowLayout {
            Layout.fillWidth: true
            spacing: Style.space(10)
            PlainText { text: root.glyph("calm"); font.pixelSize: Style.font.iconLarge }
            PlainText { Layout.fillWidth: true; text: strings.t("calm"); font.pixelSize: Style.font.subtitle; font.bold: true }
            ButtonGroup {
              options: [{ value: "off", label: strings.t("calm.off") }, { value: "on", label: strings.t("calm.on") },
                        { value: "work", label: strings.t("calm.work") }]
              value: root.saved.calm || "off"
              onChanged: function(v) { root.service.setCalm(v) }
            }
          }

          ActionButton {
            visible: !!root.saved.ornamentStyles && root.saved.ornamentStyles.length > 1
            iconText: root.glyph("baubles")
            text: strings.t("baubles").arg(root.saved.ornamentStyle || "")
            tooltipText: strings.t("baubles.tip")
            onClicked: root.service.nextOrnamentStyle()
          }
        }

        // ================================================== Friends
        ColumnLayout {
          Layout.fillWidth: true
          visible: root.view === "friends"
          spacing: Style.spacing.panelGap

          PlainText {
            Layout.fillWidth: true
            text: root.service && root.service.identity ? strings.t("friends.howto") : strings.t("friends.intro")
            wrapMode: Text.Wrap
            font.pixelSize: Style.font.caption
            opacity: 0.7
          }
          ActionButton {
            visible: !!root.service && !root.service.identity
            iconText: root.glyph("friends")
            text: strings.t("friends.setup")
            onClicked: root.service.setupFriends("")
          }
          RowLayout {
            Layout.fillWidth: true
            visible: !!root.service && !!root.service.identity
            spacing: Style.space(6)
            ActionButton { iconText: root.glyph("copy"); text: strings.t("friends.copy"); onClicked: root.service.copyFriendCode() }
            ActionButton { iconText: root.glyph("paste"); text: strings.t("friends.add"); onClicked: root.service.addFriendFromClipboard() }
          }

          RowLayout {
            Layout.fillWidth: true
            visible: !!root.service && !!root.service.identity
            spacing: Style.space(8)
            PlainText { text: strings.t("friends.yourName"); font.pixelSize: Style.font.caption; opacity: 0.75 }
            TextField {
              id: nameField
              Layout.fillWidth: true
              placeholderText: strings.t("friends.namePlaceholder")
              text: root.service && root.service.identity ? root.service.identity.name : ""
              maximumLength: 40
              onAccepted: {
                var n = text.trim()
                if (n !== "" && root.service) { root.service.setupFriends(n); focus = false }
              }
            }
          }

          PanelSectionHeader {
            visible: !!root.service && root.service.friends.length > 0
            text: strings.t("section.friends").toUpperCase()
            foreground: Commons.Color.popups.text
          }
          Repeater {
            model: root.service ? root.service.friends : []
            delegate: BorderSurface {
              required property var modelData
              readonly property bool isThrowTarget: !!root.service && !!root.service.throwFriend && root.service.throwFriend.id === modelData.id
              Layout.fillWidth: true
              implicitHeight: friendRow.implicitHeight + Style.space(16)
              radius: Style.cornerRadius
              color: "transparent"
              borderSpec: Border.controlSpec("normal", Commons.Color.popups.text, Commons.Color.accent)
              RowLayout {
                id: friendRow
                anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; leftMargin: Style.space(12); rightMargin: Style.space(6) }
                spacing: Style.space(6)
                PlainText { text: root.glyph("gift"); font.pixelSize: Style.font.icon; opacity: 0.7 }
                PlainText { Layout.fillWidth: true; text: modelData.name; elide: Text.ElideRight; font.bold: true }
                Button {
                  iconText: root.glyph("snowball")
                  tooltipText: strings.t("friends.throwTarget")
                  opacity: isThrowTarget ? 1 : 0.45
                  onClicked: root.service.setThrowTarget(modelData.id)
                }
                Button {
                  iconText: root.glyph("send")
                  tooltipText: strings.t("friends.sendNote")
                  enabled: noteField.text.trim() !== ""
                  onClicked: {
                    if (root.service.sendNote(modelData.id, noteField.text)) {
                      root.friendNote = strings.t("friends.noteSent").arg(modelData.name)
                      noteField.text = ""
                    } else {
                      root.friendNote = strings.t("friends.noteFailed")
                    }
                  }
                }
                Button {
                  iconText: root.glyph("remove")
                  tooltipText: strings.t("friends.remove")
                  onClicked: root.service.removeFriend(modelData.id)
                }
              }
            }
          }
          TextField {
            id: noteField
            Layout.fillWidth: true
            visible: !!root.service && root.service.friends.length > 0
            placeholderText: strings.t("friends.notePlaceholder")
            maximumLength: 280
            onAccepted: {
              var txt = text.trim()
              var target = root.service ? (root.service.throwFriend || root.service.friends[0]) : null
              if (!txt || !target) return
              if (root.service.sendNote(target.id, txt)) {
                root.friendNote = strings.t("friends.noteSent").arg(target.name)
                text = ""
              } else {
                root.friendNote = strings.t("friends.noteFailed")
              }
            }
          }
          PlainText {
            Layout.fillWidth: true
            visible: root.friendNote !== ""
            text: root.friendNote
            font.pixelSize: Style.font.caption
            wrapMode: Text.Wrap
            opacity: 0.75
          }
          FlagCard {
            visible: !!root.service && root.service.friends.length > 0
            flag: "throwToFriends"
            note: root.service && root.service.throwFriend ? strings.t("friends.throwTo").arg(root.service.throwFriend.name) : ""
          }
        }
      }
    }
  }
}
