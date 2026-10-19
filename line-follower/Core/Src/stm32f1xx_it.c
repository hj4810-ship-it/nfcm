/**
  ******************************************************************************
  * @file    stm32f1xx_it.c
  * @brief   中断服务函数（只需 SysTick 给 HAL 提供 1ms 时基）
  *
  * 注意：如果用的是 CubeMX 生成的工程，请直接用它生成的那份，
  *       只要确认里面有 SysTick_Handler() 调用 HAL_IncTick() 即可。
  ******************************************************************************
  */

#include "main.h"

/* Cortex-M3 内核异常 -------------------------------------------------------*/
void NMI_Handler(void)
{
    while (1) { }
}

void HardFault_Handler(void)
{
    while (1) { }
}

void MemManage_Handler(void)
{
    while (1) { }
}

void BusFault_Handler(void)
{
    while (1) { }
}

void UsageFault_Handler(void)
{
    while (1) { }
}

void SVC_Handler(void)
{
}

void DebugMon_Handler(void)
{
}

void PendSV_Handler(void)
{
}

/* 系统滴答：HAL 的 HAL_Delay() / HAL_GetTick() 靠它计时，必须保留 */
void SysTick_Handler(void)
{
    HAL_IncTick();
}
