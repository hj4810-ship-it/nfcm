/**
  ******************************************************************************
  * @file    motor_control.h
  * @brief   循迹控制：位置偏差 -> PD 运算 -> 左右轮差速
  ******************************************************************************
  */

#ifndef __MOTOR_CONTROL_H
#define __MOTOR_CONTROL_H

#include "line_sensor.h"

/* 初始化：清状态、使能驱动、停车 */
void MotorControl_Init(void);

/* 每个控制周期调用一次（建议 5ms）：
   传入刚扫描完的传感器数据，内部直接驱动电机 */
void MotorControl_Update(const LineSensor_t *s);

/* 停车（丢线超时保护也会调用它） */
void MotorControl_Stop(void);

#endif /* __MOTOR_CONTROL_H */
