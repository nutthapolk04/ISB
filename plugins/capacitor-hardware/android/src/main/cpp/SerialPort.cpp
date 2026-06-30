/*
 * Serial port JNI for kiosk peripherals (NK77 bill acceptor, NLS-EM20-85 scanner).
 * NK77 / ICT104U: 9600 8E1 (Even parity, 1 stop) per ICT104U Protocol SWD-03.
 * Based on android-serialport-api (Apache 2.0).
 */

#include <fcntl.h>
#include <jni.h>
#include <termios.h>
#include <unistd.h>

#include <android/log.h>

static constexpr const char* TAG = "okontek_serial";
#define LOGD(fmt, args...) __android_log_print(ANDROID_LOG_DEBUG, TAG, fmt, ##args)
#define LOGE(fmt, args...) __android_log_print(ANDROID_LOG_ERROR, TAG, fmt, ##args)

namespace {

class JStringUtf {
public:
    JStringUtf(JNIEnv* env, jstring str) : env_(env), str_(str) {
        if (str_ != nullptr) {
            utf_ = env_->GetStringUTFChars(str_, nullptr);
        }
    }
    ~JStringUtf() {
        if (utf_ != nullptr && str_ != nullptr) {
            env_->ReleaseStringUTFChars(str_, utf_);
        }
    }

    JStringUtf(const JStringUtf&) = delete;
    JStringUtf& operator=(const JStringUtf&) = delete;

    const char* c_str() const { return utf_ != nullptr ? utf_ : ""; }
    bool valid() const { return utf_ != nullptr; }

private:
    JNIEnv* env_;
    jstring str_;
    const char* utf_ = nullptr;
};

void throwIOException(JNIEnv* env, const char* msg) {
    jclass exClass = env->FindClass("java/io/IOException");
    if (exClass != nullptr) {
        env->ThrowNew(exClass, msg);
    }
}

speed_t getBaudrate(jint baudrate) {
    switch (baudrate) {
    case 9600: return B9600;
    case 19200: return B19200;
    case 38400: return B38400;
    case 57600: return B57600;
    case 115200: return B115200;
    default: return static_cast<speed_t>(-1);
    }
}

jint getFileDescriptorInt(JNIEnv* env, jobject fileDescriptor) {
    jclass fdClass = env->GetObjectClass(fileDescriptor);
    jfieldID field = env->GetFieldID(fdClass, "descriptor", "I");
    if (field == nullptr) {
        env->ExceptionClear();
        field = env->GetFieldID(fdClass, "fd", "I");
    }
    if (field == nullptr) {
        env->ExceptionClear();
        return -1;
    }
    return env->GetIntField(fileDescriptor, field);
}

} // namespace

static jint openSerialPort(JNIEnv* env, jstring path, jint baudrate, jint flags)
{
    const speed_t speed = getBaudrate(baudrate);
    if (speed == static_cast<speed_t>(-1)) {
        LOGE("Invalid baudrate");
        throwIOException(env, "Invalid baudrate");
        return -1;
    }

    JStringUtf pathUtf(env, path);
    if (!pathUtf.valid()) {
        throwIOException(env, "Invalid path");
        return -1;
    }

    LOGD("Opening serial port %s", pathUtf.c_str());
    const int fd = ::open(pathUtf.c_str(), O_RDWR | O_NOCTTY | flags);
    if (fd == -1) {
        LOGE("Cannot open port");
        throwIOException(env, "Cannot open port");
        return -1;
    }

    termios cfg {};
    if (tcgetattr(fd, &cfg) != 0) {
        LOGE("tcgetattr() failed");
        ::close(fd);
        throwIOException(env, "tcgetattr() failed");
        return -1;
    }

    cfmakeraw(&cfg);
    cfsetispeed(&cfg, speed);
    cfsetospeed(&cfg, speed);

    // NK77 / ICT104U: 9600 8E1 — 8 data bits, EVEN parity, 1 stop bit.
    cfg.c_cflag |= (CLOCAL | CREAD);
    cfg.c_cflag |= PARENB;     // enable parity
    cfg.c_cflag &= ~PARODD;    // even parity
    cfg.c_cflag &= ~CSTOPB;    // 1 stop bit
    cfg.c_cflag &= ~CSIZE;
    cfg.c_cflag |= CS8;
    // Pass bytes through untouched even if a parity error slips in (don't drop/mark).
    cfg.c_iflag &= ~(INPCK | ISTRIP | PARMRK);
    cfg.c_iflag &= ~(IXON | IXOFF | IXANY);
#ifdef CRTSCTS
    cfg.c_cflag &= ~CRTSCTS;
#endif
    cfg.c_cc[VMIN] = 1;
    cfg.c_cc[VTIME] = 0;

    if (tcsetattr(fd, TCSANOW, &cfg) != 0) {
        LOGE("tcsetattr() failed");
        ::close(fd);
        throwIOException(env, "tcsetattr() failed");
        return -1;
    }

    tcflush(fd, TCIOFLUSH);
    return static_cast<jint>(fd);
}

static void closeSerialPort(JNIEnv* env, jobject thiz)
{
    jclass serialPortClass = env->GetObjectClass(thiz);
    jfieldID mFdID = env->GetFieldID(serialPortClass, "mFd", "Ljava/io/FileDescriptor;");

    jobject mFd = env->GetObjectField(thiz, mFdID);
    const jint descriptor = getFileDescriptorInt(env, mFd);
    if (descriptor < 0) {
        LOGE("close: invalid FileDescriptor");
        return;
    }

    LOGD("close(fd = %d)", descriptor);
    ::close(descriptor);
}

static void flushSerialPort(JNIEnv* env, jobject thiz)
{
    jclass serialPortClass = env->GetObjectClass(thiz);
    jfieldID mFdID = env->GetFieldID(serialPortClass, "mFd", "Ljava/io/FileDescriptor;");

    jobject mFd = env->GetObjectField(thiz, mFdID);
    const jint descriptor = getFileDescriptorInt(env, mFd);
    if (descriptor < 0) {
        LOGE("flush: invalid FileDescriptor");
        return;
    }

    tcflush(descriptor, TCIOFLUSH);
}

extern "C" {

JNIEXPORT jint JNICALL Java_com_okontek_plugins_hardware_native_SerialPort_openNative
  (JNIEnv *env, jclass /*thiz*/, jstring path, jint baudrate, jint flags)
{
    return openSerialPort(env, path, baudrate, flags);
}

JNIEXPORT void JNICALL Java_com_okontek_plugins_hardware_native_SerialPort_closeNative
  (JNIEnv *env, jobject thiz)
{
    closeSerialPort(env, thiz);
}

JNIEXPORT void JNICALL Java_com_okontek_plugins_hardware_native_SerialPort_flushNative
  (JNIEnv *env, jobject thiz)
{
    flushSerialPort(env, thiz);
}

} // extern "C"
