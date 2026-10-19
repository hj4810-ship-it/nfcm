/**
  ******************************************************************************
  * @file    motor_control.c
  * @brief   循迹控制 —— 三状态机：正常循迹 / 直角弯原地转 / 丢线找回
  *
  * ① 正常循迹  |error| <  CTRL_SHARP_TURN_ERROR
  *      e    = error / 700
  *      turn = Kp*e + Ki*∫e + Kd*(e - e_last)
  *      左轮 = BASE + turn,  右轮 = BASE - turn        （边走边修）
  *
  * ② 直角弯    |error| >= CTRL_SHARP_TURN_ERROR
  *      左轮 = +PIVOT, 右轮 = -PIVOT（或反号）
  *      ==> 两轮等速反向，小车绕自身中心原地旋转，★前进分量恒为 0★
  *
  * ③ 丢线      8 路全白 -> 朝最后看到线的方向原地转，超时停车
  *
  * ============================ 直角弯的关键设计 ============================
  * 1) 进入拐弯时把"往哪边转"锁存到 s_corner_dir，整个拐弯过程不再改变；
  * 2) 拐弯途中即使短暂丢线，也继续朝锁定方向转 —— 绝不中途改用"最后看到线
  *    的方向"，否则转过中线的那一刻会把方向判反，变成反向打圈；
  * 3) 退出条件用 CTRL_SHARP_TURN_EXIT(220)，即"线必须真正回到正中"才算拐完。
  *    这个值必须明显小于进入阈值 520。之前用 400 太松：车还没转够就退出，
  *    PD 一修又把线甩到另一侧、|error| 再次超阈值，于是以反方向重新进入拐弯，
  *    表现就是"左直角正常、右直角却往左拐"。
  * 4) 拐完后有 CTRL_CORNER_SETTLE_MS 的冷却，防止紧接着又触发下一次拐弯；
  * 5) 单次拐弯有 CTRL_CORNER_MAX_MS 超时保护，防止原地转圈出不来。
  * =========================================================================
  */

#include "main.h"
#include "board_config.h"
#include "board.h"
#include "motor_control.h"
#include "tb6612.h"

#define ABSF(x)   (((x) < 0.0f) ? -(x) : (x))

typedef enum {
    ST_FOLLOW = 0,    /* 正常循迹 */
    ST_CORNER,        /* 直角弯：原地转，方向已锁存 */
    ST_SEARCH         /* 丢线找回 */
} CtrlState_t;

static CtrlState_t s_state;

static float    s_integral;      /* 积分累加 */
static float    s_last_error;    /* 上一拍的归一化偏差 */
static float    s_last_dir;      /* 最后一次看到线的方向: -1 左 / +1 右 / 0 未知 */
static float    s_corner_dir;    /* 锁存的拐弯方向: -1 左 / +1 右 */
static uint32_t s_corner_tick;   /* 进入拐弯的时刻 */
static uint32_t s_corner_done;   /* 拐弯结束的时刻（用于冷却） */
static uint32_t s_lost_tick;     /* 进入丢线状态的时刻 */

static float ClampF(float v, float lo, float hi)
{
    if (v > hi) { return hi; }
    if (v < lo) { return lo; }
    return v;
}

/* 占空比(-1~+1) -> PWM 比较值，并做死区补偿 */
static int16_t DutyToPwm(float duty)
{
    float d = ClampF(duty, -1.0f, 1.0f);

    if (d > 0.005f && d < CTRL_MIN_DUTY) {
        d = CTRL_MIN_DUTY;
    } else if (d < -0.005f && d > -CTRL_MIN_DUTY) {
        d = -CTRL_MIN_DUTY;
    }
    return (int16_t)(d * (float)MOTOR_PWM_ARR);
}

/* 原地转：两轮等速反向，前进分量 = 0。dir: -1 左 / +1 右 */
static void PivotTurn(float dir, float speed)
{
    TB6612_SetLeft (DutyToPwm( speed * dir));
    TB6612_SetRight(DutyToPwm(-speed * dir));
}

void MotorControl_Init(void)
{
    s_state       = ST_FOLLOW;
    s_integral    = 0.0f;
    s_last_error  = 0.0f;
    s_last_dir    = 0.0f;
    s_corner_dir  = 0.0f;
    s_corner_tick = 0;
    s_corner_done = 0;
    s_lost_tick   = 0;

    TB6612_Standby(1);
    TB6612_Stop();
}

void MotorControl_Stop(void)
{
    TB6612_Stop();
}

void MotorControl_Update(const LineSensor_t *s)
{
    float err = (float)s->error;
    uint32_t now = HAL_GetTick();

    /* ======================= 一、状态迁移 ======================= */
    switch (s_state) {
    case ST_FOLLOW:
        if (!s->on_line) {
            /* 丢线 */
            s_state     = ST_SEARCH;
            s_lost_tick = now;
            s_integral  = 0.0f;
            s_last_error = 0.0f;
        } else if ((ABSF(err) >= (float)CTRL_SHARP_TURN_ERROR) &&
                   ((now - s_corner_done) > CTRL_CORNER_SETTLE_MS)) {
            /* 进入直角弯：锁存方向 */
            s_state       = ST_CORNER;
            s_corner_dir  = (err > 0.0f) ? 1.0f : -1.0f;
            s_corner_tick = now;
            s_integral    = 0.0f;
            s_last_error  = 0.0f;
            Board_Printf("CORNER %c  err=%d mask=%02X\r\n",
                         (s_corner_dir > 0.0f) ? 'R' : 'L',
                         (int)s->error, (unsigned)s->active);
        }
        break;

    case ST_CORNER:
        if ((now - s_corner_tick) > CTRL_CORNER_MAX_MS) {
            /* 转太久了，多半卡住或线对着探头边缘，放弃本次拐弯 */
            s_state       = ST_FOLLOW;
            s_corner_done = now;
            s_integral    = 0.0f;
            s_last_error  = 0.0f;
            Board_Printf("corner timeout\r\n");
        } else if (s->on_line && (ABSF(err) <= (float)CTRL_SHARP_TURN_EXIT)) {
            /* 线真正回到正中了，拐弯完成 */
            s_state       = ST_FOLLOW;
            s_corner_done = now;
            s_integral    = 0.0f;
            s_last_error  = 0.0f;
            Board_Printf("corner done\r\n");
        }
        break;

    case ST_SEARCH:
    default:
        if (s->on_line) {
            /* 又看到线了，回去正常循迹 */
            s_state      = ST_FOLLOW;
            s_integral   = 0.0f;
            s_last_error = 0.0f;
        } else if ((now - s_lost_tick) > CTRL_LOST_STOP_MS) {
            TB6612_Stop();
            return;
        }
        break;
    }

    /* ======================= 二、按状态输出 ======================= */
    if (s_state == ST_CORNER) {
        /* 方向已锁存：即使此刻丢线也继续朝锁定方向转，不反打 */
        PivotTurn(s_corner_dir, CTRL_PIVOT_SPEED);
        return;
    }

    if (s_state == ST_SEARCH) {
        /* 朝最后看到线的方向原地转；s_last_dir = 0 时原地不动 */
        PivotTurn(s_last_dir, CTRL_SEARCH_SPEED);
        return;
    }

    /* ---------------- 正常循迹 ---------------- */
    if (!s->on_line) {
        TB6612_Stop();          /* 理论上进不来，兜底 */
        return;
    }

    {
        float e  = err / (float)SENSOR_ERROR_MAX;
        float de = e - s_last_error;
        float turn;
        float left;
        float right;

        s_integral += e;
        s_integral = ClampF(s_integral, -5.0f, 5.0f);

        turn = (CTRL_KP * e) + (CTRL_KI * s_integral) + (CTRL_KD * de);
        turn = ClampF(turn, -CTRL_TURN_LIMIT, CTRL_TURN_LIMIT);

        s_last_error = e;
        if (s->last_dir != 0) {
            s_last_dir = (float)s->last_dir;
        }

        left  = CTRL_BASE_SPEED + turn;
        right = CTRL_BASE_SPEED - turn;

        TB6612_SetLeft(DutyToPwm(left));
        TB6612_SetRight(DutyToPwm(right));
    }
}
