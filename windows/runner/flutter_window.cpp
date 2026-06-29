#include "flutter_window.h"

#include <optional>
#include <string>

#include "flutter/generated_plugin_registrant.h"
#include "desktop_multi_window/desktop_multi_window_plugin.h"

namespace {
constexpr int kGlobalHotkeyBaseId = 0x494D0000;

bool BoolValue(const flutter::EncodableMap& map, const char* key) {
  auto it = map.find(flutter::EncodableValue(key));
  if (it == map.end()) {
    return false;
  }
  const auto* value = std::get_if<bool>(&it->second);
  return value != nullptr && *value;
}

int IntValue(const flutter::EncodableMap& map, const char* key) {
  auto it = map.find(flutter::EncodableValue(key));
  if (it == map.end()) {
    return 0;
  }
  if (const auto* value = std::get_if<int32_t>(&it->second)) {
    return *value;
  }
  if (const auto* value = std::get_if<int64_t>(&it->second)) {
    return static_cast<int>(*value);
  }
  return 0;
}

std::string StringValue(const flutter::EncodableMap& map, const char* key) {
  auto it = map.find(flutter::EncodableValue(key));
  if (it == map.end()) {
    return "";
  }
  const auto* value = std::get_if<std::string>(&it->second);
  return value == nullptr ? "" : *value;
}
}  // namespace

FlutterWindow::FlutterWindow(const flutter::DartProject& project)
    : project_(project) {}

FlutterWindow::~FlutterWindow() {}

bool FlutterWindow::OnCreate() {
  if (!Win32Window::OnCreate()) {
    return false;
  }

  RECT frame = GetClientArea();

  // The size here must match the window dimensions to avoid unnecessary surface
  // creation / destruction in the startup path.
  flutter_controller_ = std::make_unique<flutter::FlutterViewController>(
      frame.right - frame.left, frame.bottom - frame.top, project_);
  // Ensure that basic setup of the controller was successful.
  if (!flutter_controller_->engine() || !flutter_controller_->view()) {
    return false;
  }
  RegisterPlugins(flutter_controller_->engine());
  RegisterLyricsWindowStyleChannel();
  RegisterGlobalHotkeyChannel();
  // Register plugins for child windows created by desktop_multi_window
  DesktopMultiWindowSetWindowCreatedCallback([](void *controller) {
    auto *flutter_view_controller =
        reinterpret_cast<flutter::FlutterViewController *>(controller);
    auto *registry = flutter_view_controller->engine();
    RegisterPlugins(registry);
  });
  SetChildContent(flutter_controller_->view()->GetNativeWindow());

  flutter_controller_->engine()->SetNextFrameCallback([&]() {
    this->Show();
  });

  // Flutter can complete the first frame before the "show window" callback is
  // registered. The following call ensures a frame is pending to ensure the
  // window is shown. It is a no-op if the first frame hasn't completed yet.
  flutter_controller_->ForceRedraw();

  return true;
}

void FlutterWindow::RegisterLyricsWindowStyleChannel() {
  lyrics_window_style_channel_ =
      std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
          flutter_controller_->engine()->messenger(),
          "imusic/lyrics_window_style",
          &flutter::StandardMethodCodec::GetInstance());

  lyrics_window_style_channel_->SetMethodCallHandler(
      [window = GetHandle()](const auto& call, auto result) {
        if (call.method_name() != "applyLyricsToolWindowStyle") {
          result->NotImplemented();
          return;
        }

        LONG_PTR ex_style = GetWindowLongPtr(window, GWL_EXSTYLE);
        ex_style &= ~WS_EX_APPWINDOW;
        ex_style |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        SetWindowLongPtr(window, GWL_EXSTYLE, ex_style);

        SetWindowPos(window, HWND_TOPMOST, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE |
                         SWP_FRAMECHANGED | SWP_SHOWWINDOW);
        result->Success(flutter::EncodableValue(true));
      });
}

void FlutterWindow::RegisterGlobalHotkeyChannel() {
  global_hotkey_channel_ =
      std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
          flutter_controller_->engine()->messenger(),
          "imusic/global_hotkeys",
          &flutter::StandardMethodCodec::GetInstance());

  global_hotkey_channel_->SetMethodCallHandler(
      [this](const auto& call, auto result) {
        if (call.method_name() == "unregisterHotkeys") {
          UnregisterGlobalHotkeys();
          result->Success(flutter::EncodableValue(true));
          return;
        }

        if (call.method_name() != "registerHotkeys") {
          result->NotImplemented();
          return;
        }

        UnregisterGlobalHotkeys();
        const auto* hotkeys =
            std::get_if<flutter::EncodableList>(call.arguments());
        if (hotkeys == nullptr) {
          result->Error("bad_args", "Expected a list of global hotkeys.");
          return;
        }

        int index = 0;
        for (const auto& item : *hotkeys) {
          const auto* hotkey = std::get_if<flutter::EncodableMap>(&item);
          if (hotkey == nullptr) {
            continue;
          }
          RegisterGlobalHotkey(*hotkey, kGlobalHotkeyBaseId + index);
          ++index;
        }
        result->Success(flutter::EncodableValue(true));
      });
}

bool FlutterWindow::RegisterGlobalHotkey(
    const flutter::EncodableMap& hotkey,
    int hotkey_id) {
  const std::string action_id = StringValue(hotkey, "id");
  const int key_code = IntValue(hotkey, "keyCode");
  if (action_id.empty() || key_code == 0) {
    return false;
  }

  UINT modifiers = MOD_NOREPEAT;
  if (BoolValue(hotkey, "control")) {
    modifiers |= MOD_CONTROL;
  }
  if (BoolValue(hotkey, "alt")) {
    modifiers |= MOD_ALT;
  }
  if (BoolValue(hotkey, "shift")) {
    modifiers |= MOD_SHIFT;
  }
  if (BoolValue(hotkey, "meta")) {
    modifiers |= MOD_WIN;
  }

  if (!RegisterHotKey(GetHandle(), hotkey_id, modifiers,
                      static_cast<UINT>(key_code))) {
    return false;
  }
  global_hotkey_actions_[hotkey_id] = action_id;
  return true;
}

void FlutterWindow::UnregisterGlobalHotkeys() {
  for (const auto& item : global_hotkey_actions_) {
    UnregisterHotKey(GetHandle(), item.first);
  }
  global_hotkey_actions_.clear();
}

void FlutterWindow::DispatchGlobalHotkey(WPARAM hotkey_id) {
  auto it = global_hotkey_actions_.find(static_cast<int>(hotkey_id));
  if (it == global_hotkey_actions_.end() || !global_hotkey_channel_) {
    return;
  }
  global_hotkey_channel_->InvokeMethod(
      "hotkeyPressed",
      std::make_unique<flutter::EncodableValue>(it->second));
}

void FlutterWindow::OnDestroy() {
  UnregisterGlobalHotkeys();
  if (flutter_controller_) {
    flutter_controller_ = nullptr;
  }

  Win32Window::OnDestroy();
}

LRESULT
FlutterWindow::MessageHandler(HWND hwnd, UINT const message,
                              WPARAM const wparam,
                              LPARAM const lparam) noexcept {
  // Give Flutter, including plugins, an opportunity to handle window messages.
  if (flutter_controller_) {
    std::optional<LRESULT> result =
        flutter_controller_->HandleTopLevelWindowProc(hwnd, message, wparam,
                                                      lparam);
    if (result) {
      return *result;
    }
  }

  switch (message) {
    case WM_HOTKEY:
      DispatchGlobalHotkey(wparam);
      return 0;
    case WM_FONTCHANGE:
      flutter_controller_->engine()->ReloadSystemFonts();
      break;
  }

  return Win32Window::MessageHandler(hwnd, message, wparam, lparam);
}
