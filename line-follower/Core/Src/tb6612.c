/**
  ******************************************************************************
  * @file    tb6612.c
  * @brief   TB6612FNG 双路直流电机驱动
  ******************************************************************************
  */

#include "main.h"
#include "board_config.h"
#include "tb6612.h"

static TIM_HandleTypeDef *const s_htim = &MOTOR_PWM_TIM;

/* 通用输出函数：一个通道的方向脚 + PWM 通道
   pwm > 0 正转, pwm < 0 反转, pwm == 0 自由停车 */
static void MotorOut(int16_t pwm, uint32_t channel,
                     GPIO_TypeDef *p1, uint16_t n1,
                     GPIO_TypeDef *p2, uint16_t n2)
{
    if (pwm > 0) {
        HAL_GPIO_WritePin(p1, n1, GPIO_PIN_SET);
        HAL_GPIO_WritePin(p2, n2, GPIO_PIN_RESET);
    } else if (pwm < 0) {
        pwm = (int16_t)(-pwm);
        HAL_GPIO_WritePin(p1, n1, GPIO_PIN_RESET);
        HAL_GPIO_WritePin(p2, n2, GPIO_PIN_SET);
    } else {
        HAL_GPIO_WritePin(p1, n1, GPIO_PIN_RESET);
        HAL_GPIO_WritePin(p2, n2, GPIO_PIN_RESET);
    }

    if (pwm > MOTOR_PWM_ARR) {
        pwm = MOTOR_PWM_ARR;
    }
    __HAL_TIM_SET_COMPARE(s_htim, channel, (uint32_t)pwm);
}

void TB6612_Init(void)
{
#if !MOTOR_STBY_TIED_HIGH
    /* STBY 由 IO 控制时：先确保芯片处于关断状态，再配置，避免上电瞬间电机乱冲 */
    HAL_GPIO_WritePin(MOTOR_STBY_PORT, MOTOR_STBY_PIN, GPIO_PIN_RESET);
#endif

    HAL_GPIO_WritePin(MOTOR_AIN1_PORT, MOTOR_AIN1_PIN, GPIO_PIN_RESET);
    HAL_GPIO_WritePin(MOTOR_AIN2_PORT, MOTOR_AIN2_PIN, GPIO_PIN_RESET);
    HAL_GPIO_WritePin(MOTOR_BIN1_PORT, MOTOR_BIN1_PIN, GPIO_PIN_RESET);
    HAL_GPIO_WritePin(MOTOR_BIN2_PORT, MOTOR_BIN2_PIN, GPIO_PIN_RESET);

    /* 启动两路 PWM，初始占空比 0 */
    __HAL_TIM_SET_COMPARE(s_htim, MOTOR_A_TIM_CH, 0);
    __HAL_TIM_SET_COMPARE(s_htim, MOTOR_B_TIM_CH, 0);
    HAL_TIM_PWM_Start(s_htim, MOTOR_A_TIM_CH);
    HAL_TIM_PWM_Start(s_htim, MOTOR_B_TIM_CH);

    TB6612_Standby(1);
    TB6612_Stop();
}

void TB6612_SetMotorA(int16_t pwm)
{
#if MOTOR_A_INVERT
    pwm = (int16_t)(-pwm);
#endif
    MotorOut(pwm, MOTOR_A_TIM_CH,
             MOTOR_AIN1_PORT, MOTOR_AIN1_PIN,
             MOTOR_AIN2_PORT, MOTOR_AIN2_PIN);
}

void TB6612_SetMotorB(int16_t pwm)
{
#if MOTOR_B_INVERT
    pwm = (int16_t)(-pwm);
#endif
    MotorOut(pwm, MOTOR_B_TIM_CH,
             MOTOR_BIN1_PORT, MOTOR_BIN1_PIN,
             MOTOR_BIN2_PORT, MOTOR_BIN2_PIN);
}

#if MOTOR_LEFT_IS_A
void TB6612_SetLeft(int16_t pwm)  { TB6612_SetMotorA(pwm); }
void TB6612_SetRight(int16_t pwm) { TB6612_SetMotorB(pwm); }
#else
void TB6612_SetLeft(int16_t pwm)  { TB6612_SetMotorB(pwm); }
void TB6612_SetRight(int16_t pwm) { TB6612_SetMotorA(pwm); }
#endif

void TB6612_Stop(void)
{
    TB6612_SetMotorA(0);
    TB6612_SetMotorB(0);
}

void TB6612_Brake(void)
{
    __HAL_TIM_SET_COMPARE(s_htim, MOTOR_A_TIM_CH, 0);
    __HAL_TIM_SET_COMPARE(s_htim, MOTOR_B_TIM_CH, 0);
    HAL_GPIO_WritePin(MOTOR_AIN1_PORT, MOTOR_AIN1_PIN, GPIO_PIN_SET);
    HAL_GPIO_WritePin(MOTOR_AIN2_PORT, MOTOR_AIN2_PIN, GPIO_PIN_SET);
    HAL_GPIO_WritePin(MOTOR_BIN1_PORT, MOTOR_BIN1_PIN, GPIO_PIN_SET);
    HAL_GPIO_WritePin(MOTOR_BIN2_PORT, MOTOR_BIN2_PIN, GPIO_PIN_SET);
}

void TB6612_Standby(uint8_t enable)
{
#if MOTOR_STBY_TIED_HIGH
    /* STBY 在硬件上直接接 3V3，常高，软件不做任何动作 */
    (void)enable;
#else
    HAL_GPIO_WritePin(MOTOR_STBY_PORT, MOTOR_STBY_PIN,
                      enable ? GPIO_PIN_SET : GPIO_PIN_RESET);
#endif
}
