export function wasiImports(memory, seed = 0x6d2b79f5n) {
  const unsupported = () => 52
  const view = () => new DataView(memory().buffer)
  const emptyPair = (first, second) => {
    const data = view()
    data.setUint32(first, 0, true)
    data.setUint32(second, 0, true)
    return 0
  }
  let randomState = Number(seed & 0xffffffffn) || 0x6d2b79f5
  return {
    args_get: () => 0,
    args_sizes_get: emptyPair,
    environ_get: () => 0,
    environ_sizes_get: emptyPair,
    clock_res_get: (clock, pointer) => { view().setBigUint64(pointer, 1000000n, true); return 0 },
    clock_time_get: (clock, precision, pointer) => { view().setBigUint64(pointer, BigInt(Math.floor((clock === 1 ? performance.now() : Date.now()) * 1000000)), true); return 0 },
    fd_close: unsupported,
    fd_fdstat_get: unsupported,
    fd_fdstat_set_flags: unsupported,
    fd_filestat_get: unsupported,
    fd_filestat_set_times: unsupported,
    fd_pread: unsupported,
    fd_prestat_get: unsupported,
    fd_prestat_dir_name: unsupported,
    fd_read: unsupported,
    fd_readdir: unsupported,
    fd_seek: unsupported,
    fd_sync: unsupported,
    fd_write: (fd, iovs, count, written) => { view().setUint32(written, 0, true); return 0 },
    path_create_directory: unsupported,
    path_filestat_get: unsupported,
    path_filestat_set_times: unsupported,
    path_link: unsupported,
    path_open: unsupported,
    path_readlink: unsupported,
    path_remove_directory: unsupported,
    path_rename: unsupported,
    path_symlink: unsupported,
    path_unlink_file: unsupported,
    poll_oneoff: unsupported,
    proc_exit: code => { throw new Error(`WASI exited with ${code}`) },
    random_get: (pointer, length) => {
      const bytes = new Uint8Array(memory().buffer, pointer, length)
      for (let index = 0; index < length; index += 1) {
        randomState ^= randomState << 13
        randomState ^= randomState >>> 17
        randomState ^= randomState << 5
        bytes[index] = randomState & 255
      }
      return 0
    }
  }
}
