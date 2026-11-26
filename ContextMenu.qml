import QtQuick
import qs.Commons
import qs.Commons as Commons

// The menu a decoration opens: send it to a friend, or take it away.
Rectangle {
  id: root

  property var scene: null
  readonly property var target: scene ? scene.menuFor : null
  readonly property var service: scene ? scene.service : null

  readonly property var rows: {
    if (!target || !service) return []
    var out = []
    var tr = function(k, fb) { return service && service.tr ? service.tr(k) : fb }
    if (target.kind === "tree" || target.kind === "snowman") {
      if (!service.identity) out.push({ label: tr("menu.setupFriends", "Set up friends…"), action: "setup" })
      else if (!service.friends.length) out.push({ label: tr("menu.addFriend", "Add a friend from clipboard"), action: "addFriend" })
      for (var i = 0; i < service.friends.length; i++)
        out.push({ label: tr("menu.sendTo", "Send to %1").arg(service.friends[i].name), action: "send", friend: service.friends[i].id })
    }
    out.push({ label: tr("menu.remove", "Remove"), action: "remove" })
    return out
  }

  visible: target !== null
  width: 220
  height: column.implicitHeight + 12
  x: target ? Math.min(scene.width - width - 8, target.x) : 0
  y: target ? Math.min(scene.height - height - 8, target.y) : 0
  radius: Style.cornerRadius
  color: Commons.Color.popups.background
  border.color: Commons.Color.popups.border
  border.width: 1

  Column {
    id: column
    anchors { left: parent.left; right: parent.right; top: parent.top; margins: 6 }
    Repeater {
      model: root.rows
      delegate: Rectangle {
        required property var modelData
        width: column.width
        height: 30
        radius: Math.max(0, Style.cornerRadius - 2)
        color: hover.hovered ? Qt.rgba(Commons.Color.accent.r, Commons.Color.accent.g, Commons.Color.accent.b, 0.22) : "transparent"
        HoverHandler { id: hover }
        Text {
          anchors.verticalCenter: parent.verticalCenter
          x: 10
          textFormat: Text.PlainText
          text: modelData.label
          color: modelData.action === "remove" ? Commons.Color.urgent : Commons.Color.popups.text
          font.family: Style.font.family
          font.pixelSize: Style.font.body
        }
        MouseArea {
          anchors.fill: parent
          cursorShape: Qt.PointingHandCursor
          onClicked: root.run(modelData)
        }
      }
    }
  }

  function run(row) {
    var t = target
    scene.menuFor = null
    if (row.action === "remove") service.removeItem(t.kind, t.id)
    else if (row.action === "setup") { service.setupFriends(""); service.notify("Friends are set up", "Copy your friend code from the Flurry menu in the bar.") }
    else if (row.action === "addFriend") service.addFriendFromClipboard()
    else if (row.action === "send") service.sendItem(t.kind, t.id, row.friend)
  }
}
