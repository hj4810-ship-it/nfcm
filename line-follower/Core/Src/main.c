/**
  ******************************************************************************
  * @file    main.c
  * @brief   STM32F103C8T6 + TB6612FNG + 74HC4051 八路红外模块 循迹小车
  *
  * 引脚（与实际接线一致，改线请同步改 board_config.h）：
  *   PA0        <- 74HC4051 的 OUT（ADC1_IN0）
  *   PB0/PB1/PA1-> 74HC4051 的 A0/A1/A2（通道地址）
  *   PA8        -> TB6612 PWMA (TIM1_CH1)   左轮调速
  *   PA11       -> TB6612 PWMB (TIM1_CH4)   右轮调速
  *   PB12/PB13  -> TB6612 AIN1/AIN2
  *   PB14/PB15  -> TB6612 BIN1/BIN2
  *   STBY       -> 硬件直接接 3V3（常高，不由软件控制）
  *   PA9/PA10   -> USART1，调试打印 兼 FlyMcu 串口下载
  *   PC13       -> 板载 LED
  *
  * 运行流程：
  *   1) 系统时钟 72MHz，初始化 GPIO / ADC1 / TIM1(PWM) / USART1
  *   2) 自动校准（可关）：5 秒内把小车拿在手里，让 8 个探头左右扫过黑线
  *   3) 3 秒倒计时 -> 等探头压到黑线 -> 起跑
  *   4) 200Hz 控制循环：读 8 路探头 -> 算位置偏差 -> PD 差速 -> 驱动电机
  ******************************************************************************
  */

#include "main.h"
#include "board_config.h"
#include "board.h"
#include "tb6612.h"
#include "line_sensor.h"
#include "motor_control.h"

ADC_HandleTypeDef  hadc1;
TIM_HandleTypeDef  htim1;
UART_HandleTypeDef huart1;

/* 私有函数声明 -------------------------------------------------------------*/
static void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_ADC1_Init(void);
static void MX_TIM1_Init(void);
static void MX_USART1_UART_Init(void);
static void CountDown(uint8_t seconds);

#if DEBUG_UART
static void PrintSensor(const LineSensor_t *s);
#endif

/* -------------------------------------------------------------------------- */
int main(void)
{
    uint32_t last_tick;
#if WAIT_FOR_LINE_ON_START
    uint32_t wait_tick = 0;
#endif
#if DEBUG_UART
    uint16_t dbg_cnt = 0;
#endif

    HAL_Init();
    SystemClock_Config();          /* HSE 8MHz * 9 = 72MHz */

    MX_GPIO_Init();
    MX_ADC1_Init();
    MX_TIM1_Init();                /* PA8 / PA11 -> 20kHz PWM */
    MX_USART1_UART_Init();

    Board_Init();                  /* LED + 微秒延时 */
    TB6612_Init();                 /* PWM 启动、电机停转 */
    LineSensor_Init();

    Board_Printf("\r\n=== Line Follower: STM32F103C8T6 + TB6612 + 74HC4051 x8 ===\r\n");
    Board_Printf("Kp=%d/100 Kd=%d/100 base=%d%% period=%dms\r\n",
                 (int)(CTRL_KP * 100.0f), (int)(CTRL_KD * 100.0f),
                 (int)(CTRL_BASE_SPEED * 100.0f), CTRL_PERIOD_MS);

#if MOTOR_SELF_TEST
    /* ---------------- 电机方向自检（把车架空了再上电！）----------------
       1) 两轮同速前进：正常时车不会有明显的旋转趋势
       2) 只转左轮：轮子应朝"车前进"的方向转
       3) 只转右轮：同上
       某个轮子转反了 -> 改 MOTOR_A_INVERT / MOTOR_B_INVERT
       方向都对但直行时还打转 -> 电机线接到对面端子上了，对调 AO1/AO2 或 BO1/BO2 */
    Board_Printf("=== MOTOR SELF TEST (wheels OFF the ground) ===\r\n");

    Board_Printf("1) both wheels forward\r\n");
    TB6612_SetLeft(MOTOR_PWM_ARR / 3);
    TB6612_SetRight(MOTOR_PWM_ARR / 3);
    HAL_Delay(2500);
    TB6612_Stop();
    HAL_Delay(800);

    Board_Printf("2) LEFT wheel only\r\n");
    TB6612_SetLeft(MOTOR_PWM_ARR / 3);
    HAL_Delay(2000);
    TB6612_Stop();
    HAL_Delay(800);

    Board_Printf("3) RIGHT wheel only\r\n");
    TB6612_SetRight(MOTOR_PWM_ARR / 3);
    HAL_Delay(2000);
    TB6612_Stop();

    Board_Printf("=== self test done ===\r\n");
#endif

#if SENSOR_USE_CALIBRATION
    Board_Printf("CALIBRATION: sweep the 8 sensors across the line for %d ms!\r\n",
                 SENSOR_CALIB_TIME_MS);
    LineSensor_Calibrate(&g_sensor, SENSOR_CALIB_TIME_MS);
    LineSensor_CalibrateReport(&g_sensor);
#else
    LineSensor_SetDefaultCalib(&g_sensor);
    Board_Printf("Using default calibration table in board_config.h\r\n");
#endif

    MotorControl_Init();
    CountDown(3);                  /* 给 3 秒摆车 */

#if WAIT_FOR_LINE_ON_START
    /* 安全起跑：确认探头已经压到黑线才启动，
       避免刚烧录完 / 刚上电时小车没人管就冲出去。
       等待期间每 500ms 打印一次探头数据：这样不管什么时候打开串口监视器，
       都能立刻看到实时数据，而不是对着一片空白猜。 */
    Board_Printf("Waiting for the line (put the car on the track)...\r\n");
    wait_tick = HAL_GetTick();
    while (g_sensor.on_line == 0U) {
        LineSensor_Scan(&g_sensor);
        Board_LedToggle();
        HAL_Delay(100);
#if DEBUG_UART
        if ((HAL_GetTick() - wait_tick) >= 500U) {
            wait_tick = HAL_GetTick();
            PrintSensor(&g_sensor);
        }
#endif
    }
    Board_Led(0);
    Board_Printf("Line detected, starting!\r\n");
    HAL_Delay(500);                /* 留半秒把手拿开 */
#endif

    Board_Printf("GO!\r\n");

    last_tick = HAL_GetTick();

    while (1) {
        if ((HAL_GetTick() - last_tick) >= CTRL_PERIOD_MS) {
            last_tick = HAL_GetTick();          /* 直接对齐，避免落后时连续补跑 */

            LineSensor_Scan(&g_sensor);         /* 读 8 路探头，算出偏差 */
            MotorControl_Update(&g_sensor);     /* PD 循迹 -> 电机 */

            /* LED 指示是否压线：常亮 = 在线上，闪烁 = 丢线 */
            if (g_sensor.on_line) {
                Board_Led(1);
            } else {
                Board_LedToggle();
            }

#if DEBUG_UART
            if (++dbg_cnt >= DEBUG_PRINT_DIV) {
                dbg_cnt = 0;
                PrintSensor(&g_sensor);
            }
#endif
        }
    }
}

/* -------------------------------------------------------------------------- */
/* 调试打印：8 路归一化黑度 + 偏差 + 压线掩码                                 */
/* -------------------------------------------------------------------------- */
#if DEBUG_UART
static void PrintSensor(const LineSensor_t *s)
{
    Board_Printf("N:%4u%4u%4u%4u%4u%4u%4u%4u E:%5d M:%02X %s\r\n",
                 (unsigned)s->norm[0], (unsigned)s->norm[1],
                 (unsigned)s->norm[2], (unsigned)s->norm[3],
                 (unsigned)s->norm[4], (unsigned)s->norm[5],
                 (unsigned)s->norm[6], (unsigned)s->norm[7],
                 (int)s->error, (unsigned)s->active,
                 s->on_line ? "ON" : "LOST");
}
#endif

/* -------------------------------------------------------------------------- */
/* 上电倒计时：LED 每秒闪一下，期间电机保持停转                                */
/* -------------------------------------------------------------------------- */
static void CountDown(uint8_t seconds)
{
    for (uint8_t i = 0; i < seconds; i++) {
        Board_Led(1);
        HAL_Delay(120);
        Board_Led(0);
        HAL_Delay(880);
    }
}

/* -------------------------------------------------------------------------- */
/* 系统时钟：HSE 8MHz -> PLL x9 -> 72MHz                                      */
/* -------------------------------------------------------------------------- */
static void SystemClock_Config(void)
{
    RCC_OscInitTypeDef RCC_OscInitStruct = {0};
    RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

    RCC_OscInitStruct.OscillatorType      = RCC_OSCILLATORTYPE_HSE;
    RCC_OscInitStruct.HSEState            = RCC_HSE_ON;
    RCC_OscInitStruct.HSEPredivValue      = RCC_HSE_PREDIV_DIV1;
    RCC_OscInitStruct.HSIState            = RCC_HSI_ON;
    RCC_OscInitStruct.PLL.PLLState        = RCC_PLL_ON;
    RCC_OscInitStruct.PLL.PLLSource       = RCC_PLLSOURCE_HSE;
    RCC_OscInitStruct.PLL.PLLMUL          = RCC_PLL_MUL9;
    if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK) {
        Error_Handler();
    }

    RCC_ClkInitStruct.ClockType      = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK |
                                       RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
    RCC_ClkInitStruct.SYSCLKSource   = RCC_SYSCLKSOURCE_PLLCLK;
    RCC_ClkInitStruct.AHBCLKDivider  = RCC_SYSCLK_DIV1;
    RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;   /* PCLK1 = 36MHz */
    RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;   /* PCLK2 = 72MHz，TIM1 挂在这条总线上 */
    if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK) {
        Error_Handler();
    }
}

/* -------------------------------------------------------------------------- */
/* GPIO                                                                       */
/* -------------------------------------------------------------------------- */
static void MX_GPIO_Init(void)
{
    GPIO_InitTypeDef GPIO_InitStruct = {0};

    __HAL_RCC_GPIOA_CLK_ENABLE();
    __HAL_RCC_GPIOB_CLK_ENABLE();
    __HAL_RCC_GPIOC_CLK_ENABLE();
    __HAL_RCC_AFIO_CLK_ENABLE();

    /* ---- 上电先给安全的默认电平（此时引脚还没配成输出，写 ODR 不会产生毛刺）---- */
    HAL_GPIO_WritePin(MOTOR_AIN1_PORT, MOTOR_AIN1_PIN, GPIO_PIN_RESET);
    HAL_GPIO_WritePin(MOTOR_AIN2_PORT, MOTOR_AIN2_PIN, GPIO_PIN_RESET);
    HAL_GPIO_WritePin(MOTOR_BIN1_PORT, MOTOR_BIN1_PIN, GPIO_PIN_RESET);
    HAL_GPIO_WritePin(MOTOR_BIN2_PORT, MOTOR_BIN2_PIN, GPIO_PIN_RESET);
#if !MOTOR_STBY_TIED_HIGH
    HAL_GPIO_WritePin(MOTOR_STBY_PORT, MOTOR_STBY_PIN, GPIO_PIN_RESET);
#endif
    HAL_GPIO_WritePin(SENSOR_S0_PORT, SENSOR_S0_PIN, GPIO_PIN_RESET);
    HAL_GPIO_WritePin(SENSOR_S1_PORT, SENSOR_S1_PIN, GPIO_PIN_RESET);
    HAL_GPIO_WritePin(SENSOR_S2_PORT, SENSOR_S2_PIN, GPIO_PIN_RESET);
#if LED_ACTIVE_LOW
    HAL_GPIO_WritePin(LED_PORT, LED_PIN, GPIO_PIN_SET);
#else
    HAL_GPIO_WritePin(LED_PORT, LED_PIN, GPIO_PIN_RESET);
#endif

    /* ---- PA0: 74HC4051 的 OUT -> ADC 输入（模拟模式，无上下拉）---- */
    GPIO_InitStruct.Pin  = GPIO_PIN_0;
    GPIO_InitStruct.Mode = GPIO_MODE_ANALOG;
    GPIO_InitStruct.Pull = GPIO_NOPULL;
    HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);

    /* ---- 普通推挽输出：74HC4051 地址线 + TB6612 方向脚 + LED ---- */
    GPIO_InitStruct.Mode  = GPIO_MODE_OUTPUT_PP;
    GPIO_InitStruct.Pull  = GPIO_NOPULL;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;

    GPIO_InitStruct.Pin = SENSOR_S0_PIN;  HAL_GPIO_Init(SENSOR_S0_PORT, &GPIO_InitStruct);
    GPIO_InitStruct.Pin = SENSOR_S1_PIN;  HAL_GPIO_Init(SENSOR_S1_PORT, &GPIO_InitStruct);
    GPIO_InitStruct.Pin = SENSOR_S2_PIN;  HAL_GPIO_Init(SENSOR_S2_PORT, &GPIO_InitStruct);

    GPIO_InitStruct.Pin = MOTOR_AIN1_PIN; HAL_GPIO_Init(MOTOR_AIN1_PORT, &GPIO_InitStruct);
    GPIO_InitStruct.Pin = MOTOR_AIN2_PIN; HAL_GPIO_Init(MOTOR_AIN2_PORT, &GPIO_InitStruct);
    GPIO_InitStruct.Pin = MOTOR_BIN1_PIN; HAL_GPIO_Init(MOTOR_BIN1_PORT, &GPIO_InitStruct);
    GPIO_InitStruct.Pin = MOTOR_BIN2_PIN; HAL_GPIO_Init(MOTOR_BIN2_PORT, &GPIO_InitStruct);
#if !MOTOR_STBY_TIED_HIGH
    GPIO_InitStruct.Pin = MOTOR_STBY_PIN; HAL_GPIO_Init(MOTOR_STBY_PORT, &GPIO_InitStruct);
#endif

    GPIO_InitStruct.Pin = LED_PIN;        HAL_GPIO_Init(LED_PORT, &GPIO_InitStruct);

    /* ---- PA8 / PA11: TIM1_CH1 / TIM1_CH4 复用推挽输出（TB6612 的 PWMA/PWMB）---- */
    GPIO_InitStruct.Pin   = GPIO_PIN_8 | GPIO_PIN_11;
    GPIO_InitStruct.Mode  = GPIO_MODE_AF_PP;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);

#if DEBUG_UART
    /* PA9 = USART1_TX */
    GPIO_InitStruct.Pin   = GPIO_PIN_9;
    GPIO_InitStruct.Mode  = GPIO_MODE_AF_PP;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);

    /* PA10 = USART1_RX */
    GPIO_InitStruct.Pin  = GPIO_PIN_10;
    GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
    GPIO_InitStruct.Pull = GPIO_PULLUP;
    HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);
#endif
}

/* -------------------------------------------------------------------------- */
/* ADC1: 只用一个通道 PA0，轮询方式采集 74HC4051 的输出                        */
/* -------------------------------------------------------------------------- */
static void MX_ADC1_Init(void)
{
    ADC_ChannelConfTypeDef sConfig = {0};

    __HAL_RCC_ADC1_CLK_ENABLE();
    __HAL_RCC_ADC_CONFIG(RCC_ADCPCLK2_DIV6);      /* 72MHz/6 = 12MHz，ADC 上限 14MHz */

    hadc1.Instance                   = ADC1;
    hadc1.Init.ScanConvMode          = ADC_SCAN_DISABLE;
    hadc1.Init.ContinuousConvMode    = DISABLE;
    hadc1.Init.DiscontinuousConvMode = DISABLE;
    hadc1.Init.ExternalTrigConv      = ADC_SOFTWARE_START;
    hadc1.Init.DataAlign             = ADC_DATAALIGN_RIGHT;
    hadc1.Init.NbrOfConversion       = 1;
    if (HAL_ADC_Init(&hadc1) != HAL_OK) {
        Error_Handler();
    }

    sConfig.Channel      = SENSOR_ADC_CH;
    sConfig.Rank         = ADC_REGULAR_RANK_1;
    sConfig.SamplingTime = ADC_SAMPLETIME_55CYCLES_5;   /* 采样时间要够长，源阻抗偏高 */
    if (HAL_ADC_ConfigChannel(&hadc1, &sConfig) != HAL_OK) {
        Error_Handler();
    }

    /* F1 系列必须做一次自校准 */
    if (HAL_ADCEx_Calibration_Start(&hadc1) != HAL_OK) {
        Error_Handler();
    }
}

/* -------------------------------------------------------------------------- */
/* TIM1: CH1(PA8) / CH4(PA11) 两路 PWM，20kHz                                 */
/*   注意：只使用 CH1 和 CH4 的正常输出，互补输出 CH1N/CH2N/CH3N 保持关闭       */
/*   （它们默认落在 PB13/PB14/PB15 上），这三个脚留给 TB6612 做方向控制。       */
/* -------------------------------------------------------------------------- */
static void MX_TIM1_Init(void)
{
    TIM_OC_InitTypeDef sConfigOC = {0};

    __HAL_RCC_TIM1_CLK_ENABLE();

    htim1.Instance               = TIM1;
    htim1.Init.Prescaler         = 0;                    /* 72MHz 计数 */
    htim1.Init.CounterMode       = TIM_COUNTERMODE_UP;
    htim1.Init.Period            = MOTOR_PWM_ARR;        /* 72M/(3599+1) = 20kHz */
    htim1.Init.ClockDivision     = TIM_CLOCKDIVISION_DIV1;
    htim1.Init.RepetitionCounter = 0;
    htim1.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
    if (HAL_TIM_PWM_Init(&htim1) != HAL_OK) {
        Error_Handler();
    }

    sConfigOC.OCMode     = TIM_OCMODE_PWM1;
    sConfigOC.Pulse      = 0;
    sConfigOC.OCPolarity = TIM_OCPOLARITY_HIGH;
    sConfigOC.OCFastMode = TIM_OCFAST_DISABLE;
    if (HAL_TIM_PWM_ConfigChannel(&htim1, &sConfigOC, MOTOR_A_TIM_CH) != HAL_OK) {
        Error_Handler();
    }
    if (HAL_TIM_PWM_ConfigChannel(&htim1, &sConfigOC, MOTOR_B_TIM_CH) != HAL_OK) {
        Error_Handler();
    }
}

/* -------------------------------------------------------------------------- */
/* USART1: 115200 8N1，PA9/PA10                                                */
/*   TIM1 的 CH2/CH3 默认也在 PA9/PA10 上，但本程序没有使能这两个通道，        */
/*   所以 USART1 可以正常使用。                                                */
/* -------------------------------------------------------------------------- */
static void MX_USART1_UART_Init(void)
{
#if DEBUG_UART
    __HAL_RCC_USART1_CLK_ENABLE();

    huart1.Instance          = USART1;
    huart1.Init.BaudRate     = 115200;
    huart1.Init.WordLength   = UART_WORDLENGTH_8B;
    huart1.Init.StopBits     = UART_STOPBITS_1;
    huart1.Init.Parity       = UART_PARITY_NONE;
    huart1.Init.Mode         = UART_MODE_TX_RX;
    huart1.Init.HwFlowCtl    = UART_HWCONTROL_NONE;
    huart1.Init.OverSampling = UART_OVERSAMPLING_16;
    if (HAL_UART_Init(&huart1) != HAL_OK) {
        Error_Handler();
    }
#endif
}

/* -------------------------------------------------------------------------- */
/* HAL 底层初始化（用 CubeMX 生成工程时这些通常放在 stm32f1xx_hal_msp.c 里）   */
/* -------------------------------------------------------------------------- */
void HAL_MspInit(void)
{
    __HAL_RCC_AFIO_CLK_ENABLE();
    __HAL_RCC_PWR_CLK_ENABLE();
}

/* -------------------------------------------------------------------------- */
void Error_Handler(void)
{
    __disable_irq();
    while (1) {
        /* 快闪 LED 表示出错 */
        HAL_GPIO_TogglePin(LED_PORT, LED_PIN);
        for (volatile uint32_t i = 0; i < 400000U; i++) {
            __NOP();
        }
    }
}
