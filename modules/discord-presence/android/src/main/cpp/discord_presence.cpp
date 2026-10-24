// JNI bridge between DiscordBridge.kt and the Discord Social SDK.
//
// Only Rich Presence over RPC is used: the SDK talks to the Discord app
// installed on the phone, so no OAuth / Client::Connect is needed. Every call
// (including RunCallbacks) comes from the same Kotlin worker thread.

#include <android/log.h>
#include <jni.h>

#include <memory>
#include <optional>
#include <string>

#define DISCORDPP_IMPLEMENTATION
#include "discordpp.h"

#define LOG_TAG "QuartzDiscord"

namespace {

std::shared_ptr<discordpp::Client> client;

// Set only while RunCallbacks runs, so SDK callbacks can report back to Kotlin.
JNIEnv *callbackEnv = nullptr;
jobject callbackObj = nullptr;
jmethodID onResultMethod = nullptr;

void report(bool ok, const std::string &message) {
  if (!callbackEnv || !callbackObj || !onResultMethod) return;
  jstring text = callbackEnv->NewStringUTF(message.c_str());
  callbackEnv->CallVoidMethod(callbackObj, onResultMethod, static_cast<jboolean>(ok), text);
  callbackEnv->DeleteLocalRef(text);
}

std::optional<std::string> optional(JNIEnv *env, jstring value) {
  if (!value) return std::nullopt;
  const char *chars = env->GetStringUTFChars(value, nullptr);
  std::string result(chars);
  env->ReleaseStringUTFChars(value, chars);
  if (result.empty()) return std::nullopt;
  return result;
}

}  // namespace

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_discordpresence_DiscordBridge_nativeStart(JNIEnv *, jobject, jlong applicationId) {
  if (client) return;
  client = std::make_shared<discordpp::Client>();
  client->AddLogCallback(
      [](std::string message, discordpp::LoggingSeverity) {
        __android_log_print(ANDROID_LOG_INFO, LOG_TAG, "%s", message.c_str());
      },
      discordpp::LoggingSeverity::Warning);
  client->SetApplicationId(static_cast<uint64_t>(applicationId));
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_discordpresence_DiscordBridge_nativeUpdate(JNIEnv *env,
                                                             jobject,
                                                             jstring name,
                                                             jstring details,
                                                             jstring state,
                                                             jstring largeImage,
                                                             jstring largeText,
                                                             jstring smallImage,
                                                             jstring smallText,
                                                             jlong startMs,
                                                             jlong endMs,
                                                             jstring buttonLabel,
                                                             jstring buttonUrl) {
  if (!client) return;

  discordpp::Activity activity;
  activity.SetType(discordpp::ActivityTypes::Listening);
  // Without an explicit name, Discord on Android labels RPC activities "Game".
  if (auto n = optional(env, name)) activity.SetName(*n);
  // The member list reads "Escuchando <song>" instead of the app name.
  activity.SetStatusDisplayType(discordpp::StatusDisplayTypes::Details);
  activity.SetDetails(optional(env, details));
  activity.SetState(optional(env, state));

  discordpp::ActivityAssets assets;
  assets.SetLargeImage(optional(env, largeImage));
  assets.SetLargeText(optional(env, largeText));
  assets.SetSmallImage(optional(env, smallImage));
  assets.SetSmallText(optional(env, smallText));
  activity.SetAssets(assets);

  // Start + end make Discord draw a progress bar, like other music apps.
  if (startMs > 0 || endMs > 0) {
    discordpp::ActivityTimestamps timestamps;
    if (startMs > 0) timestamps.SetStart(static_cast<uint64_t>(startMs));
    if (endMs > 0) timestamps.SetEnd(static_cast<uint64_t>(endMs));
    activity.SetTimestamps(timestamps);
  }
  // In an open room: a button (seen by others) that opens the invite page.
  auto label = optional(env, buttonLabel);
  auto url = optional(env, buttonUrl);
  if (label && url) {
    discordpp::ActivityButton button;
    button.SetLabel(*label);
    button.SetUrl(*url);
    activity.AddButton(button);
  }
  client->UpdateRichPresence(std::move(activity), [](discordpp::ClientResult result) {
    bool ok = result.Successful();
    report(ok, ok ? "ok" : result.Error());
  });
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_discordpresence_DiscordBridge_nativeClear(JNIEnv *, jobject) {
  if (client) client->ClearRichPresence();
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_discordpresence_DiscordBridge_nativeRunCallbacks(JNIEnv *env, jobject self) {
  if (!onResultMethod) {
    jclass cls = env->GetObjectClass(self);
    onResultMethod = env->GetMethodID(cls, "onResult", "(ZLjava/lang/String;)V");
    env->DeleteLocalRef(cls);
  }
  callbackEnv = env;
  callbackObj = self;
  discordpp::RunCallbacks();
  callbackEnv = nullptr;
  callbackObj = nullptr;
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_discordpresence_DiscordBridge_nativeStop(JNIEnv *env, jobject self) {
  if (!client) return;
  client->ClearRichPresence();
  // Let the clear reach Discord before the client goes away.
  Java_expo_modules_discordpresence_DiscordBridge_nativeRunCallbacks(env, self);
  client.reset();
}
