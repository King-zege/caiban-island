import koffi from 'koffi';
import { ACRYLIC_TINT, buildGradientColor } from '../shared/acrylic';
import type { ColorScheme } from '../shared/types';

const ACCENT_DISABLED = 0;
const ACCENT_ENABLE_ACRYLICBLURBEHIND = 4;
const ACCENT_ENABLE_BLURBEHIND = 3;
const WCA_ACCENT_POLICY = 19;

interface AccentPolicyValue {
  AccentState: number;
  AccentFlags: number;
  GradientColor: number;
  AnimationId: number;
}

interface WcaDataValue {
  Attribute: number;
  Data: AccentPolicyValue;
  SizeOfData: number;
}

interface NativeBindings {
  accentPolicySize: number;
  setWindowCompositionAttribute: (hwnd: number, data: WcaDataValue) => number;
}

let cachedBindings: NativeBindings | null | undefined;

function nativeBindings(): NativeBindings | null {
  if (cachedBindings !== undefined) return cachedBindings;
  try {
    const user32 = koffi.load('user32.dll');
    const AccentPolicy = koffi.struct('AccentPolicy', {
      AccentState: 'int32',
      AccentFlags: 'uint32',
      GradientColor: 'uint32',
      AnimationId: 'int32'
    });
    const WCAData = koffi.struct('WCAData', {
      Attribute: 'int32',
      Data: 'AccentPolicy*',
      SizeOfData: 'uint32'
    });
    koffi.sizeof(WCAData);
    const nativeFunction = user32.func('int SetWindowCompositionAttribute(int64 hwnd, WCAData* data)');
    cachedBindings = {
      accentPolicySize: koffi.sizeof(AccentPolicy),
      setWindowCompositionAttribute: nativeFunction as unknown as NativeBindings['setWindowCompositionAttribute']
    };
  } catch {
    cachedBindings = null;
  }
  return cachedBindings;
}

// 注意：Electron getNativeWindowHandle() 返回的是句柄值的 Buffer，
// 传给 koffi 时必须读出数值并按 int64 传递，不能把 Buffer 当指针。
function hwndValue(hwnd: Buffer): number {
  return Number(hwnd.readBigUInt64LE(0));
}

// Win10 1803+ / Win11：为透明窗口启用系统 Acrylic 模糊；
// 失败时级联到普通 Blur，再失败返回 false 由上层回退纯色。
function setAccent(hwndBuffer: Buffer, state: number, scheme: ColorScheme): boolean {
  const hwnd = hwndValue(hwndBuffer);
  const tint = ACRYLIC_TINT[scheme];
  const gradient = state === ACCENT_DISABLED ? 0 : buildGradientColor(tint.a, tint.b, tint.g, tint.r);
  try {
    const bindings = nativeBindings();
    if (!bindings) return false;
    const call = (state: number): boolean =>
      bindings.setWindowCompositionAttribute(hwnd, {
        Attribute: WCA_ACCENT_POLICY,
        Data: { AccentState: state, AccentFlags: 0, GradientColor: gradient, AnimationId: 0 },
        SizeOfData: bindings.accentPolicySize
      }) !== 0;
    if (state === ACCENT_DISABLED) return call(ACCENT_DISABLED);
    if (call(ACCENT_ENABLE_ACRYLICBLURBEHIND)) return true;
    return call(ACCENT_ENABLE_BLURBEHIND);
  } catch {
    return false;
  }
}

export function applyAcrylic(hwndBuffer: Buffer, scheme: ColorScheme): boolean {
  return setAccent(hwndBuffer, ACCENT_ENABLE_ACRYLICBLURBEHIND, scheme);
}

export function disableAcrylic(hwndBuffer: Buffer): boolean {
  return setAccent(hwndBuffer, ACCENT_DISABLED, 'dark');
}
