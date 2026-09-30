// Movement tuning for the KINETIC player. All units are meters / seconds / radians.
// Everything that shapes the feel of movement lives here so it can be tuned in one place.

import { GRAVITY } from '../core/constants.js';

const DEG = Math.PI / 180;

export const MOVE = {
  // ---- simulation
  STEP: 1 / 120,            // fixed physics step
  MAX_STEPS: 10,            // max sub-steps per rendered frame (spiral-of-death guard)

  // ---- ground (Quake style)
  WALK_SPEED: 6.2,
  SPRINT_SPEED: 9.6,
  CROUCH_SPEED: 3.2,
  GROUND_ACCEL: 11,
  FRICTION: 7,
  STOP_SPEED: 3,
  GROUND_MIN_Y: 0.7,        // min surface normal.y that counts as walkable ground (~45 deg)
  SNAP_DIST: 0.35,          // ground snapping distance
  SNAP_MAX_UP_SPEED: 6.4,   // going up a slope faster than this launches off the crest instead of snapping
  STEP_UP: 0.5,             // automatic step-up height (curbs, pipes, crates)
  STEP_LOOKAHEAD: 0.2,      // a step-up advances at least this far so the round capsule gets over the edge
  STEP_SMOOTH: 16,          // decay rate of the camera offset that hides step-ups and step-downs
  ADS_SPEED_LOSS: 0.28,     // walk speed lost at full ADS

  // ---- air
  GRAVITY,
  TERMINAL: 55,
  AIR_ACCEL: 6,             // quake-style air acceleration factor
  AIR_CAP: 3.1,             // wish-speed cap used by the air accelerator (air strafing)
  AIR_TURN: 1.15,           // rad/s the velocity direction is steered toward the wish direction (speed preserving)
  AIR_SOFT_CAP0: 12.5,      // strafe gains fade out between these horizontal speeds
  AIR_SOFT_CAP1: 17.5,

  // ---- jumping
  JUMP_SPEED: 8.0,
  DOUBLE_JUMP_SPEED: 7.4,
  DOUBLE_JUMP_REDIRECT: 0.6,
  COYOTE: 0.12,
  JUMP_BUFFER: 0.12,
  HARD_LAND_SPEED: 13,      // impact speed for 'land_hard'
  LAND_PENALTY_START: 16,   // impact speed where a landing costs horizontal speed (crouch / slide avoids it)
  LAND_PENALTY_MAX: 0.2,

  // ---- crouch & slide
  SLIDE_MIN_START: 6.5,
  SLIDE_BOOST: 2.5,
  SLIDE_BOOST_CAP: 14,
  SLIDE_BOOST_COOLDOWN: 1.2,
  SLIDE_FRICTION: 0.9,
  SLIDE_END_SPEED: 3.5,
  SLIDE_STEER: 1.1,         // rad/s
  SLIDE_SLOPE: 1.3,         // multiplier of the gravity component along the slope
  SLIDE_MAX: 22,
  SLIDE_PRESS_WINDOW: 0.3,  // crouch press this recently before landing still slides
  EYE_DAMP_DOWN: 16,
  EYE_DAMP_UP: 11,

  // ---- wall running
  WALLRUN_MIN_SPEED: 4.5,
  WALLRUN_SPEED: 10.5,
  WALLRUN_MAX: 13,
  WALLRUN_TIME: 1.7,
  WALLRUN_GRAV_START: 0.2,  // gravity scale at the start of a run, ramps to 1
  WALLRUN_SINK_START: 0.35,  // sink speed limit at the start (m/s), ramps to WALLRUN_SINK_END
  WALLRUN_SINK_END: 6.0,
  WALLRUN_REACH: 0.45,      // wall detection reach beyond the capsule radius
  WALLRUN_MIN_HEIGHT: 1.0,  // min height above the ground to start
  WALLRUN_ROLL: 14 * DEG,
  WALLRUN_SAME_WALL_LOCK: 0.5,
  WALLRUN_MAX_NORMAL_Y: 0.22, // |normal.y| above this is not a wall (floor / ceiling / slope)
  WALLJUMP_NORMAL: 7.5,
  WALLJUMP_UP: 8.2,
  WALLJUMP_MAX_PER_AIR: 3,  // wall jumps per airtime (each one a bit weaker) - no infinite climbing
  WALLRUN_MAX_PER_AIR: 3,   // wall runs per airtime
  WALL_COYOTE: 0.15,

  // ---- mantle
  MANTLE_MIN: 0.55,
  MANTLE_MAX: 2.3,
  MANTLE_TIME: 0.28,
  MANTLE_REACH: 0.5,        // beyond the capsule radius
  MANTLE_EXIT_SPEED: 4,
  MANTLE_COOLDOWN: 0.3,

  // ---- grapple
  GRAPPLE_RANGE: 45,
  GRAPPLE_HOOK_SPEED: 110,
  GRAPPLE_PULL: 38,
  GRAPPLE_GRAVITY: 0.5,
  GRAPPLE_SPEED_CAP: 24,
  GRAPPLE_ARRIVE_SPEED: 12,   // speed cap when the anchor is about to be reached (soft arrival)
  GRAPPLE_BRAKE: 45,          // m/s^2 used to slow down toward that cap
  GRAPPLE_RELEASE_DIST: 2.2,
  GRAPPLE_MAX_TIME: 3,
  GRAPPLE_COOLDOWN: 3.5,
  GRAPPLE_MISS_COOLDOWN: 0.8,
  GRAPPLE_JUMP_BOOST: 5,
  GRAPPLE_AIR_CONTROL: 0.7,

  // ---- misc
  SPRINT_LOCK: 0.35,        // seconds sprint stays off after cancelSprint()
  STAND_EYE_FROM_TOP: 0.14,
};
