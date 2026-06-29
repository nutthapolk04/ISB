/*
 * Serial port JNI for ICT NK77 bill acceptor (9600 8E1).
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

} // namespace

JNIEXPORT jobject JNICALL Java_com_okontek_plugins_hardware_native_SerialPort_open
  (JNIEnv *env, jclass /*thiz*/, jstring path, jint baudrate, jint flags)
{
    const speed_t speed = getBaudrate(baudrate);
    if (speed == static_cast<speed_t>(-1)) {
        LOGE("Invalid baudrate");
        throwIOException(env, "Invalid baudrate");
        return nullptr;
    }

    JStringUtf pathUtf(env, path);
    if (!pathUtf.valid()) {
        throwIOException(env, "Invalid path");
        return nullptr;
    }

    LOGD("Opening serial port %s", pathUtf.c_str());
    const int fd = ::open(pathUtf.c_str(), O_RDWR | flags);
    if (fd == -1) {
        LOGE("Cannot open port");
        throwIOException(env, "Cannot open port");
        return nullptr;
    }

    termios cfg {};
    if (tcgetattr(fd, &cfg) != 0) {
        LOGE("tcgetattr() failed");
        ::close(fd);
        throwIOException(env, "tcgetattr() failed");
        return nullptr;
    }

    cfmakeraw(&cfg);
    cfsetispeed(&cfg, speed);
    cfsetospeed(&cfg, speed);

    // ICT NK77: 9600 8E1
    cfg.c_cflag |= PARENB;
    cfg.c_cflag &= ~PARODD;
    cfg.c_cflag &= ~CSTOPB;
    cfg.c_cflag |= CS8;

    if (tcsetattr(fd, TCSANOW, &cfg) != 0) {
        LOGE("tcsetattr() failed");
        ::close(fd);
        throwIOException(env, "tcsetattr() failed");
        return nullptr;
    }

    jclass cFileDescriptor = env->FindClass("java/io/FileDescriptor");
    jmethodID iFileDescriptor = env->GetMethodID(cFileDescriptor, "<init>", "()V");
    jfieldID descriptorID = env->GetFieldID(cFileDescriptor, "fd", "I");
    jobject mFileDescriptor = env->NewObject(cFileDescriptor, iFileDescriptor);
    env->SetIntField(mFileDescriptor, descriptorID, static_cast<jint>(fd));
    return mFileDescriptor;
}

JNIEXPORT void JNICALL Java_com_okontek_plugins_hardware_native_SerialPort_closeNative
  (JNIEnv *env, jobject thiz)
{
    jclass serialPortClass = env->GetObjectClass(thiz);
    jclass fileDescriptorClass = env->FindClass("java/io/FileDescriptor");

    jfieldID mFdID = env->GetFieldID(serialPortClass, "mFd", "Ljava/io/FileDescriptor;");
    jfieldID descriptorID = env->GetFieldID(fileDescriptorClass, "fd", "I");

    jobject mFd = env->GetObjectField(thiz, mFdID);
    jint descriptor = env->GetIntField(mFd, descriptorID);

    LOGD("close(fd = %d)", descriptor);
    ::close(descriptor);
}

JNIEXPORT void JNICALL Java_com_okontek_plugins_hardware_native_SerialPort_flushNative
  (JNIEnv *env, jobject thiz)
{
    jclass serialPortClass = env->GetObjectClass(thiz);
    jclass fileDescriptorClass = env->FindClass("java/io/FileDescriptor");

    jfieldID mFdID = env->GetFieldID(serialPortClass, "mFd", "Ljava/io/FileDescriptor;");
    jfieldID descriptorID = env->GetFieldID(fileDescriptorClass, "fd", "I");

    jobject mFd = env->GetObjectField(thiz, mFdID);
    jint descriptor = env->GetIntField(mFd, descriptorID);

    tcflush(descriptor, TCIOFLUSH);
}
