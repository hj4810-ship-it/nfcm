/**
  ******************************************************************************
  * @file    board.c
  * @brief   板级小工具：LED、微秒延时、串口打印
  ******************************************************************************
  */

#include "main.h"
#include "board_config.h"
#include "board.h"

#include <stdio.h>
#include <stdarg.h>

void Board_Init(void)
{
    /* 使能 DWT 周期计数器：Cortex-M3 自带，用来做精确的微秒延时 */
    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CYCCNT = 0;
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;

    Board_Led(0);
}

void Board_Led(uint8_t on)
{
#if LED_ACTIVE_LOW
    HAL_GPIO_WritePin(LED_PORT, LED_PIN, on ? GPIO_PIN_RESET : GPIO_PIN_SET);
#else
    HAL_GPIO_WritePin(LED_PORT, LED_PIN, on ? GPIO_PIN_SET : GPIO_PIN_RESET);
#endif
}

void Board_LedToggle(void)
{
    HAL_GPIO_TogglePin(LED_PORT, LED_PIN);
}

void Board_DelayUs(uint32_t us)
{
    uint32_t start = DWT->CYCCNT;
    uint32_t ticks = us * (SystemCoreClock / 1000000U);

    if (ticks == 0U) {
        ticks = 1U;
    }
    /* CYCCNT 是 32 位，72MHz 下约 59.6s 溢出一次，
       用无符号减法比较可以自动处理回绕 */
    while ((DWT->CYCCNT - start) < ticks) {
        __NOP();
    }
}

int Board_Printf(const char *fmt, ...)
{
#if DEBUG_UART
    char buf[128];
    va_list ap;
    int n;

    va_start(ap, fmt);
    n = vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);

    if (n > 0) {
        uint16_t len = (n < (int)sizeof(buf)) ? (uint16_t)n : (uint16_t)(sizeof(buf) - 1U);
        HAL_UART_Transmit(&huart1, (uint8_t *)buf, len, 50);
    }
    return n;
#else
    (void)fmt;
    return 0;
#endif
}
