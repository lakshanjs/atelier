// Moves a window of this process to a given Windows virtual desktop, so test windows open where the tests were started
// instead of on whichever desktop is in front. Windows only lets a process move its own windows, so this is loaded into the
// test copy of the app as a Node-API module. It finds the Node-API functions in the running app itself, and declares the
// few Windows functions it needs, so it builds with the bare C compiler: no Windows SDK, Node or Electron headers.
// build.ps1 builds it; the tests do that themselves when it's missing.
typedef unsigned long DWORD; typedef long HRESULT; typedef unsigned short WCHAR; typedef void *HWND, *HMODULE;
typedef struct { unsigned long a; unsigned short b, c; unsigned char d[8]; } GUID;
__declspec(dllimport) HMODULE __stdcall GetModuleHandleW(const WCHAR *);
__declspec(dllimport) void *__stdcall GetProcAddress(HMODULE, const char *);
__declspec(dllimport) int __stdcall MultiByteToWideChar(unsigned, DWORD, const char *, int, WCHAR *, int);
__declspec(dllimport) HRESULT __stdcall CoInitializeEx(void *, DWORD);
__declspec(dllimport) HRESULT __stdcall CoCreateInstance(const GUID *, void *, DWORD, const GUID *, void **);
__declspec(dllimport) HRESULT __stdcall CLSIDFromString(const WCHAR *, GUID *);

// IVirtualDesktopManager, from shobjidl_core.h
typedef struct VDM VDM;
typedef struct {
  HRESULT (__stdcall *QueryInterface)(VDM *, const GUID *, void **); unsigned long (__stdcall *AddRef)(VDM *); unsigned long (__stdcall *Release)(VDM *);
  HRESULT (__stdcall *IsWindowOnCurrentVirtualDesktop)(VDM *, HWND, int *); HRESULT (__stdcall *GetWindowDesktopId)(VDM *, HWND, GUID *); HRESULT (__stdcall *MoveWindowToDesktop)(VDM *, HWND, const GUID *);
} VDMVtbl;
struct VDM { const VDMVtbl *v; };
static const GUID CLSID_VDM = { 0xaa509086, 0x5ca9, 0x4c25, { 0x8f, 0x95, 0x58, 0x9d, 0x3c, 0x07, 0xb4, 0x8a } };
static const GUID IID_VDM = { 0xa5cd92ff, 0x29be, 0x454c, { 0x8d, 0x04, 0xd8, 0x28, 0x79, 0xfb, 0x3f, 0x1b } };

typedef struct napi_env__ *napi_env; typedef struct napi_value__ *napi_value; typedef struct napi_callback_info__ *napi_callback_info;
typedef int napi_status; typedef napi_value (*napi_callback)(napi_env, napi_callback_info);
static napi_status (*get_cb_info)(napi_env, napi_callback_info, unsigned long long *, napi_value *, napi_value *, void **);
static napi_status (*get_buffer_info)(napi_env, napi_value, void **, unsigned long long *);
static napi_status (*get_string)(napi_env, napi_value, char *, unsigned long long, unsigned long long *);
static napi_status (*create_int32)(napi_env, int, napi_value *);
static napi_status (*create_function)(napi_env, const char *, unsigned long long, napi_callback, void *, napi_value *);
static napi_status (*set_named_property)(napi_env, napi_value, const char *, napi_value);

// move(hwndBuffer, "{desktop guid}") returns the HRESULT, 0 when it worked
static napi_value move(napi_env env, napi_callback_info info) {
  unsigned long long argc = 2, len = 0; napi_value argv[2], out; void *data = 0; char id[64]; WCHAR wid[64]; HRESULT hr = (HRESULT)0x80070057; VDM *m = 0; GUID g;
  int i; for (i = 0; i < 64; i++) { id[i] = 0; wid[i] = 0; }
  get_cb_info(env, info, &argc, argv, 0, 0);
  if (argc == 2 && get_buffer_info(env, argv[0], &data, &len) == 0 && len >= sizeof(HWND) && get_string(env, argv[1], id, sizeof id, &len) == 0) {
    HWND hwnd = *(HWND *)data;
    MultiByteToWideChar(65001, 0, id, -1, wid, 64);
    CoInitializeEx(0, 2);   // already done on the app's main thread, which is fine
    hr = CLSIDFromString(wid, &g);
    if (hr >= 0) hr = CoCreateInstance(&CLSID_VDM, 0, 0x17, &IID_VDM, (void **)&m);
    if (hr >= 0) { hr = m->v->MoveWindowToDesktop(m, hwnd, &g); m->v->Release(m); }
  }
  create_int32(env, (int)hr, &out);
  return out;
}

__declspec(dllexport) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  HMODULE app = GetModuleHandleW(0); napi_value fn;
  get_cb_info = GetProcAddress(app, "napi_get_cb_info");
  get_buffer_info = GetProcAddress(app, "napi_get_buffer_info");
  get_string = GetProcAddress(app, "napi_get_value_string_utf8");
  create_int32 = GetProcAddress(app, "napi_create_int32");
  create_function = GetProcAddress(app, "napi_create_function");
  set_named_property = GetProcAddress(app, "napi_set_named_property");
  if (!get_cb_info || !get_buffer_info || !get_string || !create_int32 || !create_function || !set_named_property) return exports;
  if (create_function(env, "move", 4, move, 0, &fn) == 0) set_named_property(env, exports, "move", fn);
  return exports;
}
