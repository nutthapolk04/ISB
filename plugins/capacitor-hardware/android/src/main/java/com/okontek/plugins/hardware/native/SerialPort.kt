package com.okontek.plugins.hardware.native

import java.io.File
import java.io.FileDescriptor
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

class SerialPort(
    device: File,
    baudRate: Int,
    flags: Int = 0
) {

    private val mFd: FileDescriptor
    val inputStream: InputStream
    val outputStream: OutputStream

    init {
        mFd = open(device.absolutePath, baudRate, flags)
        inputStream = FileInputStream(mFd)
        outputStream = FileOutputStream(mFd)
    }

    fun close() {
        closeNative()
    }

    fun flush() {
        flushNative()
    }

    private external fun closeNative()

    private external fun flushNative()

    companion object {
        init {
            System.loadLibrary("okontek_serial")
        }

        private fun open(path: String, baudRate: Int, flags: Int): FileDescriptor {
            val fd = openNative(path, baudRate, flags)
            if (fd < 0) {
                throw IOException("Cannot open serial port: $path")
            }
            return wrapFileDescriptor(fd)
        }

        /**
         * Android hides FileDescriptor.fd; the internal field is "descriptor".
         */
        private fun wrapFileDescriptor(fd: Int): FileDescriptor {
            val fileDescriptor = FileDescriptor()
            val field = FileDescriptor::class.java.getDeclaredField("descriptor")
            field.isAccessible = true
            field.setInt(fileDescriptor, fd)
            return fileDescriptor
        }

        @JvmStatic
        private external fun openNative(
            path: String,
            baudRate: Int,
            flags: Int
        ): Int
    }
}
