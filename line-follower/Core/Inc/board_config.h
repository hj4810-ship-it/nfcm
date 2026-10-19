/**
  ******************************************************************************
  * @file    board_config.h
  * @brief   巡线小车 —— 全部硬件接线与可调参数都集中在这个文件里
  *
  * 硬件平台:  STM32F103C8T6 (72MHz, 64KB Flash)
  * 电机驱动:  TB6612FNG
  * 循迹传感器: 74HC4051 八路红外巡线模块
  *
  * >>> 本文件的引脚定义与你实际的接线一一对应，换线时同步改这里即可 <<<
  ******************************************************************************
  */

#ifndef __BOARD_CONFIG_H
#define __BOARD_CONFIG_H

#include "stm32f1xx_hal.h"

/* ==========================================================================
 * 一、循迹传感器：74HC4051 八路红外模块
 * --------------------------------------------------------------------------
 * 74HC4051 是一片 8 选 1 模拟开关：
 *   单片机用 A2/A1/A0 三个 IO 送出 3 位地址，选中 8 路探头中的某一路，
 *   被选中探头的信号就从公共端 OUT 输出，接到单片机的 PA0（ADC）上。
 *   所以 8 路探头一共只占用 MCU 的 3 个普通 IO + 1 个 ADC 通道。
 *
 *   地址真值表:   A2 A1 A0  ->  选中的探头
 *                 0  0  0   ->  0
 *                 0  0  1   ->  1
 *                 0  1  0   ->  2
 *                 0  1  1   ->  3
 *                 1  0  0   ->  4
 *                 1  0  1   ->  5
 *                 1  1  0   ->  6
 *                 1  1  1   ->  7
 *
 *   接线:
 *     模块 OUT -> PA0 (ADC1_IN0)
 *     模块 A0  -> PB0
 *     模块 A1  -> PB1
 *     模块 A2  -> PA1
 *     模块 GND -> GND          <-- 必须与主控共地，否则读数乱跳
 *     模块 +5V -> 见下面的警告
 *
 *   !!! 重要：PA0 是模拟输入脚，不属于 5V 容忍(FT)引脚，电压绝不能超过 3.3V。
 *       红外板如果按 5V 供电，它的 OUT 很可能就是 5V 电平，直接进 PA0 会通过
 *       内部保护二极管持续灌电流 —— 轻则 ADC 读数不准、跳动，重则打坏引脚。
 *       两种解决办法，任选一种：
 *         方案 A（最省事，推荐）：把红外板的 +5V 改接到 STM32 的 3V3。
 *              绝大多数 74HC4051 红外板 3.3V 也能正常工作，只是探测距离略短。
 *         方案 B（要保留 5V 供电）：在 OUT 和 PA0 之间做电阻分压，例如
 *              OUT --1kΩ--+-- PA0，再从 PA0 到 GND 接 1.5kΩ，
 *              5V 被压到约 3.0V，既安全又不影响判断。
 * ========================================================================== */
#define SENSOR_ADC              hadc1
#define SENSOR_ADC_CH           ADC_CHANNEL_0   /* PA0 */

#define SENSOR_S0_PORT          GPIOB           /* 模块 A0 */
#define SENSOR_S0_PIN           GPIO_PIN_0
#define SENSOR_S1_PORT          GPIOB           /* 模块 A1 */
#define SENSOR_S1_PIN           GPIO_PIN_1
#define SENSOR_S2_PORT          GPIOA           /* 模块 A2 */
#define SENSOR_S2_PIN           GPIO_PIN_1

#define SENSOR_NUM              8       /* 探头数量，不要改 */
#define SENSOR_SETTLE_US        50      /* 切换地址后等待信号稳定的时间(us)。
                                           如果相邻通道读数互相串扰，加大到 100~200 */
#define SENSOR_OVERSAMPLE       4       /* 每个通道重复采样次数(取平均)，提高信噪比 */

#define SENSOR_BLACK_IS_HIGH    0       /* 1 = 黑线读数更大；0 = 黑线读数更小。
                                           本车实测：白底读数大、压黑线读数小 -> 填 0。
                                           改完必须重新上电校准（5 秒扫线），否则归一化还是反的 */

#define SENSOR_ACTIVE_LEVEL     300     /* 归一化值(0~1000)超过它才认为该探头"压线" */
#define SENSOR_ORDER_REVERSED   0       /* 0 = 0 号探头在车体最左边; 1 = 顺序反过来。
                                           发现"往反方向修正"时改这里 */

#define SENSOR_USE_CALIBRATION  1       /* 1 = 每次上电手动扫线自动校准; 0 = 用下面的默认表 */
#define SENSOR_CALIB_TIME_MS    5000    /* 自动校准持续时间(ms)：这段时间里让探头左右扫过黑线 */
#define SENSOR_CALIB_MIN_RANGE  300     /* 校准中黑白差值小于该值的通道视为没扫到，改用默认表 */

/* 默认校准表：SENSOR_USE_CALIBRATION = 0 时使用；也可以把自动校准打印出来的值抄到这里。
   数值是 12 位 ADC 原始值(0~4095)：
     MIN = 校准过程中该通道出现过的最小读数
     MAX = 校准过程中该通道出现过的最大读数
   （只是"数值大小"，不区分黑白：本车 SENSOR_BLACK_IS_HIGH = 0，
     所以压黑线时读数更小，MIN 对应黑线、MAX 对应白底。）
   顺序：下标 0 = 车体最左边的探头 … 下标 7 = 最右边 */
#define SENSOR_MIN_DEFAULT      {200, 200, 200, 200, 200, 200, 200, 200}
#define SENSOR_MAX_DEFAULT      {2800, 2800, 2800, 2800, 2800, 2800, 2800, 2800}


/* ==========================================================================
 * 二、TB6612FNG 电机驱动
 * --------------------------------------------------------------------------
 *   单片机              TB6612        说明
 *   PA8  (TIM1_CH1) -- PWMA          左轮调速
 *   PB12 ------------ AIN1
 *   PB13 ------------ AIN2
 *   PA11 (TIM1_CH4) -- PWMB          右轮调速
 *   PB14 ------------ BIN1
 *   PB15 ------------ BIN2
 *   (不接)            STBY          直接接 3V3 常高，软件不控制
 *
 *   VM(蓝色端子 +)  -> 电池正极 7.4V
 *   VM(蓝色端子 -)  -> 电池负极 / GND
 *   VCC(3V3)        -> STM32 3V3    逻辑电源，接 5V 会导致电平识别失败
 *   GND             -> STM32 GND    必须共地
 *   AO1/AO2 -> 左电机    BO1/BO2 -> 右电机
 *
 *   方向真值表:  AIN1 AIN2 = 1 0 -> 正转
 *                            0 1 -> 反转
 *                            0 0 -> 自由停车(滑行)
 *                            1 1 -> 刹车(短接)
 *
 *   注: PB13/PB14/PB15 正好也是 TIM1 的互补输出脚(CH1N/CH2N/CH3N)。本程序只用了
 *       TIM1 的 CH1 和 CH4 正常输出，互补输出(CCxNE)没有使能，所以这三个脚可以
 *       安全地当普通 GPIO 做方向控制。
 * ========================================================================== */
#define MOTOR_PWM_TIM           htim1           /* PA8=TIM1_CH1, PA11=TIM1_CH4 */
#define MOTOR_PWM_ARR           3599            /* 72MHz/(3599+1) = 20kHz，与 MX_TIM1_Init() 一致 */

#define MOTOR_A_TIM_CH          TIM_CHANNEL_1   /* PA8  -> PWMA -> 左轮 */
#define MOTOR_B_TIM_CH          TIM_CHANNEL_4   /* PA11 -> PWMB -> 右轮 */

#define MOTOR_AIN1_PORT         GPIOB
#define MOTOR_AIN1_PIN          GPIO_PIN_12
#define MOTOR_AIN2_PORT         GPIOB
#define MOTOR_AIN2_PIN          GPIO_PIN_13

#define MOTOR_BIN1_PORT         GPIOB
#define MOTOR_BIN1_PIN          GPIO_PIN_14
#define MOTOR_BIN2_PORT         GPIOB
#define MOTOR_BIN2_PIN          GPIO_PIN_15

/* STBY 接法：1 = 硬件直接接 3V3（常高，软件不控制）—— 你现在就是这种接法
              0 = STBY 接到单片机 IO，由 MOTOR_STBY_PORT/PIN 控制 */
#define MOTOR_STBY_TIED_HIGH    1

/* 下面两行只有 MOTOR_STBY_TIED_HIGH = 0 时才起作用 */
#define MOTOR_STBY_PORT         GPIOB
#define MOTOR_STBY_PIN          GPIO_PIN_5

#define MOTOR_LEFT_IS_A         1       /* 左轮接在 A 通道 -> 1; 左轮接在 B 通道 -> 0 */
#define MOTOR_A_INVERT          0       /* 哪个轮子转反了，就把对应的改成 1 */
#define MOTOR_B_INVERT          1       /* =1：右轮(B 通道)整体取反。
                                           实测右轮方向反了，所以这里置 1；
                                           若以后把右电机的两根线对调接回，记得改回 0，
                                           否则会"反两次"又变回错的。 */

/* 如果你以后换回 TIM3 + PA6/PA7 的接法，把上面几行改成：
     #define MOTOR_PWM_TIM   htim3
     #define MOTOR_A_TIM_CH  TIM_CHANNEL_1     (PA6)
     #define MOTOR_B_TIM_CH  TIM_CHANNEL_2     (PA7)
   并把主程序里的 MX_TIM1_Init() 对应的改成 TIM3 即可。 */


/* ==========================================================================
 * 三、循迹控制参数（调车主要动这里，README 里有对应现象的调节表）
 *
 * 控制分三种状态：
 *   ① 正常循迹   |error| <  CTRL_SHARP_TURN_ERROR   -> PD 差速，边走边修
 *   ② 直角弯/急弯 |error| >= CTRL_SHARP_TURN_ERROR   -> 原地转，前进分量 = 0
 *   ③ 丢线       on_line == 0                        -> 朝最后方向原地转，前进分量 = 0
 * ========================================================================== */
#define CTRL_PERIOD_MS          5       /* 控制周期(ms)，即 200Hz */
#define CTRL_KP                 0.55f   /* 比例：偏离越多修正越猛 */
#define CTRL_KI                 0.00f   /* 积分：巡线一般不需要，保持 0 */
#define CTRL_KD                 1.20f   /* 微分：抑制摆动，越大越稳，过大反而抖 */
#define CTRL_BASE_SPEED         0.50f   /* 基础速度，占空比 0~1（0.5 = 一半油门）。
                                           直角弯已经改成"原地转、不前进"，所以基础速度
                                           可以放开一些；但也不要超过 0.60，否则高速下
                                           冲到弯口才触发原地转，会滑出去。
                                           弯道冲过头就先退到 0.45。
                                           嫌慢可以逐步加：0.55 → 0.60 */

#define CTRL_TURN_LIMIT         1.00f   /* 转向量限幅，防止超出 ±1 */
#define CTRL_MIN_DUTY           0.16f   /* 电机死区补偿：小于它的输出会被抬到该值，
                                           否则电机只会嗡嗡响不转 */

/* ---- 直角弯 / 急弯：原地转，不前进 ---- */
#define CTRL_PIVOT_SPEED        0.40f   /* 原地转的转速（一个轮正转、一个轮反转） */
#define CTRL_SHARP_TURN_ERROR   520     /* 进入判据：|error| >= 它 -> 进入原地转
                                           （error 范围 ±700，520 约等于"线压到最外侧两个探头"） */
#define CTRL_SHARP_TURN_EXIT    220     /* 退出判据：|error| <= 它 -> 线已真正回到正中，拐弯完成。
                                           ★ 必须明显小于进入阈值 ★ 取值太松（比如 400）会导致
                                             "还没转够就退出 -> PD 一修又超阈值 -> 反向再拐"，
                                             表现就是"右直角只会往左拐"。 */
#define CTRL_CORNER_SETTLE_MS   100     /* 拐完之后再等这么久才允许触发下一次拐弯，防止连触发 */
#define CTRL_CORNER_MAX_MS      1200    /* 单次拐弯最长持续时间，超时强制结束，防止原地转圈出不来 */

/* ---- 丢线找回 —— 同样是原地转，不前进 ---- */
#define CTRL_SEARCH_SPEED       0.40f   /* 丢线后原地找线的转速 */
#define CTRL_LOST_STOP_MS       2000    /* 丢线超过该时间仍找不到线 -> 停车保护 */

/* 安全起跑：1 = 倒计时结束后，必须等探头真的压到黑线才开跑。
   避免刚烧录完 / 刚上电时小车没人管就冲出去。 */
#define WAIT_FOR_LINE_ON_START  1


/* ==========================================================================
 * 四、调试
 * ========================================================================== */
#define DEBUG_UART              1       /* 1 = 用 USART1(PA9=TX/PA10=RX, 115200) 打印状态。
                                           FlyMcu 下载用的也是这两个脚，一个 USB-TTL 通吃。
                                           调好车以后可以改成 0（打印是阻塞的，会轻微拖慢控制循环）。 */
#define DEBUG_PRINT_DIV         50      /* 每多少个控制周期打印一行(50 x 5ms = 250ms)。
                                           串口打印是阻塞的，调好车以后建议改成 0 */

/* 电机自检：1 = 上电后先做一轮电机方向自检（必须把车架空再开！）
   顺序：两轮同速前进 2.5s -> 只转左轮 2s -> 只转右轮 2s
   用来判断"哪个轮子转向反了 / 电机线接错"，排完故障记得改回 0。
   正常现象：三轮子都朝"车前进"的方向转。 */
#define MOTOR_SELF_TEST         0

/* 状态指示灯：本板的 LED 接在 PA4 上（不是蓝 Pill 常见的 PC13） */
#define LED_PORT                GPIOA
#define LED_PIN                 GPIO_PIN_4
/* LED 极性：0 = 高电平点亮（引脚 -> 电阻 -> LED -> GND，最常见）
             1 = 低电平点亮（3V3 -> LED -> 电阻 -> 引脚） */
#define LED_ACTIVE_LOW          0

#endif /* __BOARD_CONFIG_H */
