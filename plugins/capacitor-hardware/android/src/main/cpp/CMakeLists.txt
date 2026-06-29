cmake_minimum_required(VERSION 3.4.1)

project(okontek_serial LANGUAGES C CXX)

add_library(okontek_serial SHARED SerialPort.cpp)

find_library(log-lib log)

target_link_libraries(okontek_serial ${log-lib})

target_link_options(okontek_serial PRIVATE "-Wl,-z,max-page-size=16384")
