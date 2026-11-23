import fs from 'node:fs';
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const config=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
const cargo=fs.readFileSync('src-tauri/Cargo.toml','utf8').match(/^version = "([^"]+)"/m)?.[1];
if(config.version!==pkg.version||cargo!==pkg.version)throw new Error('Package, Tauri and Rust versions must match');
if(process.env.GITHUB_REF_TYPE==='tag'&&process.env.GITHUB_REF_NAME!==`v${pkg.version}`)throw new Error('Tag must match the application version');
if(!fs.readFileSync(`docs/releases/${pkg.version}.md`,'utf8').trim())throw new Error('Release notes are required');
console.log(`Versions agree: ${pkg.version}`);
