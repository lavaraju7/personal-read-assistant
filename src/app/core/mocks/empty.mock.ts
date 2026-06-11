// Empty mock for Node.js modules in the browser bundle
export const existsSync = () => false;
export const readFileSync = () => null;
export const promises = {};
export const resolve = () => '';
export const join = () => '';
export const dirname = () => '';
export const homedir = () => '';
export const cpus = () => [];
export const platform = () => '';
export const arch = () => '';
export const spawn = () => null;
export const spawnSync = () => null;
export const exec = () => null;
export const execSync = () => null;
export const createReadStream = () => null;
export const createWriteStream = () => null;
export class Writable {}
export class Readable {}
export class Transform {}
export const fileURLToPath = () => '';

export default {
  existsSync,
  readFileSync,
  promises,
  resolve,
  join,
  dirname,
  homedir,
  cpus,
  platform,
  arch,
  spawn,
  spawnSync,
  exec,
  execSync,
  createReadStream,
  createWriteStream,
  Writable,
  Readable,
  Transform,
  fileURLToPath,
};
