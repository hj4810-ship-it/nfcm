/**
  ******************************************************************************
  * @file    tb6612.h
  * @brief   TB6612FNG 双路直流电机驱动
  ******************************************************************************
  */

#ifndef __TB6612_H
#define __TB6612_H

#include <stdint.h>

/* 初始化：启动 PWM，STBY 拉高，两个电机停转 */
void TB6612_Init(void);

/* 直接控制 A / B 通道，pwm 取值 -MOTOR_PWM_ARR ~ +MOTOR_PWM_ARR
   正数正转，负数反转，0 自由停车 */
void TB6612_SetMotorA(int16_t pwm);
void TB6612_SetMotorB(int16_t pwm);

/* 按"左右"控制，内部自动处理 MOTOR_LEFT_IS_A 和 *_INVERT */
void TB6612_SetLeft(int16_t pwm);
void TB6612_SetRight(int16_t pwm);

/* 自由停车（滑行） */
void TB6612_Stop(void);
/* 刹车（电机两端短接，立刻停） */
void TB6612_Brake(void);

/* STBY 引脚控制：0 = 整片关断 */
void TB6612_Standby(uint8_t enable);

#endif /* __TB6612_H */
