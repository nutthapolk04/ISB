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
            ?: throw IOException("Cannot open serial port: ${device.absolutePath}")
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

        @JvmStatic
        private external fun open(
            path: String,
            baudRate: Int,
            flags: Int
        ): FileDescriptor?
    }
}
