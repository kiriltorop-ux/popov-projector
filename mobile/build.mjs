import './compile-templates.mjs';
import {cp,mkdir,writeFile,readdir,readFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await cp('docs','dist',{recursive:true});
await writeFile('dist/.nojekyll','');
for(const file of await readdir('dist')){
 if(!/\.(html|js|mjs|css)$/.test(file))continue;
 const text=await readFile('dist/'+file,'utf8');
 if(/(?:src|href)=["']\/(?!\/)|from ['"]\//.test(text))throw Error('Absolute asset URL: '+file);
}
console.log('GitHub Pages build: dist/ — relative assets, no server required.');
