cmake_minimum_required(VERSION 3.22)
project(quartz_discord CXX)

add_library(discord_partner_sdk SHARED IMPORTED)
set_target_properties(discord_partner_sdk PROPERTIES
  IMPORTED_LOCATION ${DISCORD_SDK_DIR}/libs/android.${ANDROID_ABI}/libdiscord_partner_sdk.so
  INTERFACE_INCLUDE_DIRECTORIES ${DISCORD_SDK_DIR}/include)

add_library(quartz_discord SHARED discord_presence.cpp)
target_link_libraries(quartz_discord discord_partner_sdk log)
