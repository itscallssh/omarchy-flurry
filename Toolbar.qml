pragma ComponentBehavior: Bound
import QtQuick
import qs.Commons
import qs.Commons as Commons

// Decorate mode's tools, along the bottom of the screen.
Rectangle {
  id: root

  property var scene: null
  readonly property var service: scene ? scene.service : null

  function labelFor(id, fallback) { return service && service.tr ? service.tr(id) : fallback }

  readonly property var tools: [
    { id: "tree", label: labelFor("toolbar.tree", "Tree"), glyph: "🎄" },
    { id: "snowman", label: labelFor("toolbar.snowman", "Snowman"), glyph: "⛄" },
    { id: "bauble", label: labelFor("toolbar.bauble", "Bauble"), glyph: "🔴" },
    { id: "light", label: labelFor("toolbar.treeLights", "Tree lights"), glyph: "💡" },
    { id: "string", label: labelFor("toolbar.windowLights", "Window lights"), glyph: "✨" },
    { id: "candy", label: labelFor("toolbar.candy", "Candy cane"), glyph: "🍬" },
    { id: "star", label: labelFor("toolbar.star", "Star"), glyph: "⭐" },
    { id: "erase", label: labelFor("toolbar.erase", "Remove"), glyph: "✕" }
  ]

  width: row.implicitWidth + 20
  height: 64
  x: scene ? (scene.width - width) / 2 : 0
  y: scene ? scene.groundY - height - 24 : 0
  radius: Style.cornerRadius
  color: Commons.Color.popups.background
  border.color: Commons.Color.popups.border
  border.width: 1

  Row {
    id: row
    anchors.centerIn: parent
    spacing: 6

    Repeater {
      model: root.tools
      delegate: Rectangle {
        id: tile
        required property var modelData
        readonly property bool selected: root.scene && root.scene.tool === tile.modelData.id
        width: Math.max(64, label.implicitWidth + 14); height: 50
        radius: Math.max(0, Style.cornerRadius - 2)
        color: tile.selected ? Qt.rgba(Commons.Color.accent.r, Commons.Color.accent.g, Commons.Color.accent.b, 0.35)
             : (hover.hovered ? Qt.rgba(Commons.Color.accent.r, Commons.Color.accent.g, Commons.Color.accent.b, 0.15) : "transparent")
        HoverHandler { id: hover }
        Column {
          anchors.centerIn: parent
          spacing: 2
          Text { anchors.horizontalCenter: parent.horizontalCenter; textFormat: Text.PlainText; text: tile.modelData.glyph; font.pixelSize: 18 }
          Text {
            id: label
            anchors.horizontalCenter: parent.horizontalCenter
            textFormat: Text.PlainText
            text: tile.modelData.id === "tree" ? tile.modelData.label + " " + (root.service ? root.service.saved.trees.length : 0) + "/3" : tile.modelData.label
            color: Commons.Color.popups.text
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }
        }
        MouseArea {
          anchors.fill: parent
          cursorShape: Qt.PointingHandCursor
          onClicked: root.scene.tool = tile.selected ? "" : tile.modelData.id
        }
      }
    }

    Rectangle { width: 1; height: 40; anchors.verticalCenter: parent.verticalCenter; color: Commons.Color.popups.border }

    Rectangle {
      width: 70; height: 50
      radius: Math.max(0, Style.cornerRadius - 2)
      color: Commons.Color.accent
      Text {
        anchors.centerIn: parent
        textFormat: Text.PlainText
        text: root.labelFor("toolbar.done", "Done")
        color: Commons.Color.background
        font.family: Style.font.family
        font.pixelSize: Style.font.body
        font.bold: true
      }
      MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: { root.scene.tool = ""; root.service.stopDecorating() } }
    }
  }
}
