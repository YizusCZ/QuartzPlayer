//! Quartz's native core: reads tags and stream info from audio files off the
//! JS thread, several at a time. A faithful port of src/library/metadata.ts,
//! which stays as the fallback (`npm run test:rust` compares the two).
mod metadata;

pub use metadata::{parse_batch, parse_file};

#[cfg(target_os = "android")]
mod android {
    use jni::objects::{JClass, JString};
    use jni::sys::jstring;
    use jni::JNIEnv;
    use std::panic::catch_unwind;

    /// `items` is path, name, path, name… separated by 0x1F. Returns a JSON array.
    #[no_mangle]
    pub extern "system" fn Java_expo_modules_quartzcore_RustCore_parseBatch(
        mut env: JNIEnv,
        _class: JClass,
        items: JString,
        art_dir: JString,
    ) -> jstring {
        let items: String = env.get_string(&items).map(Into::into).unwrap_or_default();
        let art_dir: String = env.get_string(&art_dir).map(Into::into).unwrap_or_default();
        let json = catch_unwind(|| crate::parse_batch(&items, &art_dir)).unwrap_or_else(|_| "[]".to_string());
        env.new_string(json).map(|s| s.into_raw()).unwrap_or(std::ptr::null_mut())
    }
}
