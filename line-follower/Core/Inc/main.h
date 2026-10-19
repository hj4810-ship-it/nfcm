/**
  ******************************************************************************
  * @file    main.h
  * @brief   全局句柄与公共声明
  ******************************************************************************
  */

#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "stm32f1xx_hal.h"

/* 外设句柄（在 main.c 中定义） */
extern ADC_HandleTypeDef  hadc1;
extern TIM_HandleTypeDef  htim1;
extern UART_HandleTypeDef huart1;

void Error_Handler(void);

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
