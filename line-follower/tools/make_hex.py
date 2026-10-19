"""
PlatformIO 编译后自动生成 firmware.hex

背景：ststm32 平台默认只产出 firmware.elf 和 firmware.bin，不生成 hex。
本脚本在链接完成后调用工具链自带的 arm-none-eabi-objcopy 转一个 hex 出来，
方便用 FlyMcu 之类的串口/图形化工具烧录。

特点：任何一步出错都只打警告，**不会让编译失败**，
      最坏情况就是没有 hex，直接烧 firmware.bin 也一样能用。
"""

Import("env")  # noqa: F821  (SCons 环境由 PlatformIO 注入)

import os
import shutil
import subprocess


def _find_objcopy(env):
    """依次尝试：平台变量 $OBJCOPY -> PlatformIO 工具链目录 -> 系统 PATH"""
    candidate = env.subst("$OBJCOPY")
    if candidate and shutil.which(candidate):
        return candidate

    home = os.path.expanduser("~")
    for pkg in ("toolchain-gccarmnoneeabi", "toolchain-gccarmnoneeabi@1"):
        for exe in ("arm-none-eabi-objcopy.exe", "arm-none-eabi-objcopy"):
            path = os.path.join(home, ".platformio", "packages", pkg, "bin", exe)
            if os.path.isfile(path):
                return path

    return shutil.which("arm-none-eabi-objcopy")


def make_hex(source, target, env):
    elf = str(target[0])
    hexfile = os.path.splitext(elf)[0] + ".hex"

    objcopy = _find_objcopy(env)
    if not objcopy:
        print("[make_hex] 找不到 arm-none-eabi-objcopy，跳过 hex 生成。"
              "直接烧 firmware.bin 效果完全一样。")
        return

    try:
        subprocess.run([objcopy, "-O", "ihex", elf, hexfile], check=True)
        print("[make_hex] HEX 已生成: %s" % hexfile)
    except Exception as exc:                      # noqa: BLE001
        print("[make_hex] 生成 hex 失败: %s" % exc)
        print("[make_hex] 不影响编译结果，可直接烧 firmware.bin。")


# 链接输出（firmware.elf）生成之后执行
env.AddPostAction("$BUILD_DIR/${PROGNAME}.elf", make_hex)  # noqa: F821
