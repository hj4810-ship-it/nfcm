/**
  ******************************************************************************
  * @file    line_sensor.c
  * @brief   74HC4051 八路巡线传感器
  *
  * 采样流程（每个探头）：
  *   1. S2/S1/S0 送出该探头的地址
  *   2. 等 SENSOR_SETTLE_US 微秒，让 4051 的输出和后续 RC 稳定下来
  *   3. 丢弃一次转换（切换瞬间的值不可信），再连续采 SENSOR_OVERSAMPLE 次取平均
  *
  * 偏差计算：以探头的"黑度"为权重做加权平均
  *   位置  pos[i] = i*2 - 7        (最左 -7 … 最右 +7)
  *   偏差  error  = Σ(norm[i]*pos[i]) / Σ(norm[i]) * 100
  *   error < 0 线在左边 -> 需要左转;  error > 0 线在右边 -> 需要右转
  * 这样即使线只压住两个探头之间，也能得到亚探头精度的偏差，比纯开关量平滑得多。
  ******************************************************************************
  */

#include "main.h"
#include "board_config.h"
#include "board.h"
#include "line_sensor.h"

LineSensor_t g_sensor;

/* 默认校准表 */
static const uint16_t kDefaultMin[SENSOR_NUM] = SENSOR_MIN_DEFAULT;
static const uint16_t kDefaultMax[SENSOR_NUM] = SENSOR_MAX_DEFAULT;

/* -------------------------------------------------------------------------- */
/* 内部函数                                                                   */
/* -------------------------------------------------------------------------- */

/* 逻辑序号(0=最左) -> 74HC4051 的物理通道号 */
static uint8_t PhysIndex(uint8_t logical)
{
#if SENSOR_ORDER_REVERSED
    return (uint8_t)(SENSOR_NUM - 1U - logical);
#else
    return logical;
#endif
}

/* 送出 3 位地址，选中一路探头 */
static void SelectChannel(uint8_t ch)
{
    HAL_GPIO_WritePin(SENSOR_S0_PORT, SENSOR_S0_PIN,
                      (ch & 0x01U) ? GPIO_PIN_SET : GPIO_PIN_RESET);
    HAL_GPIO_WritePin(SENSOR_S1_PORT, SENSOR_S1_PIN,
                      (ch & 0x02U) ? GPIO_PIN_SET : GPIO_PIN_RESET);
    HAL_GPIO_WritePin(SENSOR_S2_PORT, SENSOR_S2_PIN,
                      (ch & 0x04U) ? GPIO_PIN_SET : GPIO_PIN_RESET);
}

/* 单次 ADC 转换（轮询方式） */
static uint16_t AdcReadOnce(void)
{
    uint16_t value = 0;

    HAL_ADC_Start(&SENSOR_ADC);
    if (HAL_ADC_PollForConversion(&SENSOR_ADC, 10) == HAL_OK) {
        value = (uint16_t)HAL_ADC_GetValue(&SENSOR_ADC);
    }
    HAL_ADC_Stop(&SENSOR_ADC);
    return value;
}

/* 选中某个物理通道并读回平均值 */
static uint16_t ReadChannel(uint8_t ch)
{
    uint32_t sum = 0;

    SelectChannel(ch);
    Board_DelayUs(SENSOR_SETTLE_US);

    (void)AdcReadOnce();                     /* 丢弃第一次，避开切换毛刺 */
    for (uint8_t i = 0; i < SENSOR_OVERSAMPLE; i++) {
        sum += AdcReadOnce();
    }
    return (uint16_t)(sum / SENSOR_OVERSAMPLE);
}

/* 原始值 -> 0~1000 的"黑度" */
static uint16_t Normalize(const LineSensor_t *s, uint8_t idx, uint16_t raw)
{
    int32_t lo = (int32_t)s->min[idx];
    int32_t hi = (int32_t)s->max[idx];
    int32_t v;

    if (hi <= lo) {
        return 0;
    }
#if SENSOR_BLACK_IS_HIGH
    v = ((int32_t)raw - lo) * 1000 / (hi - lo);   /* 越黑值越大 */
#else
    v = (hi - (int32_t)raw) * 1000 / (hi - lo);   /* 越黑值越小 -> 反过来 */
#endif
    if (v < 0)    { v = 0; }
    if (v > 1000) { v = 1000; }
    return (uint16_t)v;
}

/* -------------------------------------------------------------------------- */
/* 对外接口                                                                   */
/* -------------------------------------------------------------------------- */

void LineSensor_SetDefaultCalib(LineSensor_t *s)
{
    for (uint8_t i = 0; i < SENSOR_NUM; i++) {
        s->min[i]   = kDefaultMin[i];
        s->max[i]   = kDefaultMax[i];
        s->valid[i] = 1;
        s->raw[i]   = 0;
        s->norm[i]  = 0;
    }
    s->error    = 0;
    s->active   = 0;
    s->count    = 0;
    s->on_line  = 0;
    s->last_dir = 0;
}

void LineSensor_Init(void)
{
    SelectChannel(0);
    HAL_Delay(2);
    LineSensor_SetDefaultCalib(&g_sensor);
    LineSensor_Scan(&g_sensor);
}

uint16_t LineSensor_ReadRaw(uint8_t ch)
{
    if (ch >= SENSOR_NUM) {
        return 0;
    }
    return ReadChannel(ch);
}

void LineSensor_Calibrate(LineSensor_t *s, uint32_t duration_ms)
{
    uint16_t mn[SENSOR_NUM];
    uint16_t mx[SENSOR_NUM];
    uint32_t t0;
    uint32_t tled;

    for (uint8_t i = 0; i < SENSOR_NUM; i++) {
        mn[i] = 0xFFFFU;
        mx[i] = 0;
    }

    t0   = HAL_GetTick();
    tled = t0;

    while ((HAL_GetTick() - t0) < duration_ms) {
        for (uint8_t i = 0; i < SENSOR_NUM; i++) {
            uint16_t raw = ReadChannel(PhysIndex(i));
            if (raw < mn[i]) { mn[i] = raw; }
            if (raw > mx[i]) { mx[i] = raw; }
        }
        /* LED 每 100ms 翻转一次，提示"正在校准" */
        if ((HAL_GetTick() - tled) >= 100U) {
            tled = HAL_GetTick();
            Board_LedToggle();
        }
    }

    for (uint8_t i = 0; i < SENSOR_NUM; i++) {
        if ((uint16_t)(mx[i] - mn[i]) < SENSOR_CALIB_MIN_RANGE) {
            /* 这一路没扫到明显的黑白差异（探头坏 / 没对准 / 离地太高），退回默认表 */
            s->min[i]   = kDefaultMin[i];
            s->max[i]   = kDefaultMax[i];
            s->valid[i] = 0;
        } else {
            s->min[i]   = mn[i];
            s->max[i]   = mx[i];
            s->valid[i] = 1;
        }
    }

    s->error    = 0;
    s->last_dir = 0;
    Board_Led(0);
}

void LineSensor_CalibrateReport(const LineSensor_t *s)
{
    Board_Printf("--- calibration result (12bit raw) ---\r\n");

    Board_Printf("MIN:");
    for (uint8_t i = 0; i < SENSOR_NUM; i++) {
        Board_Printf("%5u", (unsigned)s->min[i]);
    }
    Board_Printf("\r\n");

    Board_Printf("MAX:");
    for (uint8_t i = 0; i < SENSOR_NUM; i++) {
        Board_Printf("%5u", (unsigned)s->max[i]);
    }
    Board_Printf("\r\n");

    Board_Printf("VALID:");
    for (uint8_t i = 0; i < SENSOR_NUM; i++) {
        Board_Printf("%5u", (unsigned)s->valid[i]);
    }
    Board_Printf("\r\n");
    Board_Printf("(copy MIN/MAX into SENSOR_MIN_DEFAULT / SENSOR_MAX_DEFAULT)\r\n");
}

void LineSensor_Scan(LineSensor_t *s)
{
    int32_t sum_w  = 0;
    int32_t sum_wp = 0;
    uint16_t mask  = 0;
    uint8_t  cnt   = 0;

    for (uint8_t i = 0; i < SENSOR_NUM; i++) {
        uint16_t raw = ReadChannel(PhysIndex(i));
        uint16_t n   = Normalize(s, i, raw);

        s->raw[i]  = raw;
        s->norm[i] = n;

        if (n >= SENSOR_ACTIVE_LEVEL) {
            /* 位置：最左 -7 … 最右 +7，步进 2 */
            int32_t pos = ((int32_t)i * 2) - (SENSOR_NUM - 1);
            sum_w  += (int32_t)n;
            sum_wp += (int32_t)n * pos;
            mask   |= (uint16_t)(1U << i);
            cnt++;
        }
    }

    s->active  = mask;
    s->count   = cnt;
    s->on_line = (cnt > 0U) ? 1U : 0U;

    if (cnt > 0U) {
        /* sum_wp / sum_w 得到 -7~+7 之间的位置，乘 100 变成 -700~+700 */
        s->error = (int16_t)((sum_wp * 100) / sum_w);
        /* 记住最后一次看清楚的偏离方向，丢线时用它判断往哪边找 */
        if (s->error > 60 || s->error < -60) {
            s->last_dir = (s->error > 0) ? 1 : -1;
        }
    } else {
        /* 丢线时偏差交给控制层用 last_dir 处理 */
        s->error = 0;
    }
}
