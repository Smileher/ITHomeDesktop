fn main() {
    println!("cargo:rerun-if-env-changed=ITHOME_STORE_BUILD");
    tauri_build::build()
}
