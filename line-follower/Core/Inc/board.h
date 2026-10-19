/**
  ******************************************************************************
  * @file    board.h
  * @brief   板级小工具：LED、微秒延时、串口打印
  ******************************************************************************
  */

#ifndef __BOARD_H
#define __BOARD_H

#include <stdint.h>

/* 初始化：使能 DWT 周期计数器（用于微秒延时），LED 熄灭 */
void Board_Init(void);

void Board_Led(uint8_t on);
void Board_LedToggle(void);

/* 忙等微秒延时，基于 DWT 周期计数器，误差很小 */
void Board_DelayUs(uint32_t us);

/* 串口打印，DEBUG_UART = 0 时什么都不做 */
int  Board_Printf(const char *fmt, ...);

#endif /* __BOARD_H */
