(() => {
  "use strict";

  const ASSET_DATA_URL =
    "data:image/png;base64,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";

  const FRAME_SECONDS = 1 / 60;
  const SPRING_STEP_SECONDS = 1 / 240;
  const MAX_CATCHUP_SECONDS = 1;
  const SHORT_MOVE_THRESHOLD = 196;
  const POINTER_CENTER = 12;
  const HIDDEN_SCALE = 0.4;
  const HIDDEN_BLUR = 5;
  const ARRIVAL_DISTANCE = 0.85;
  const ARRIVAL_SPEED = 12;
  const POINTER_REST_ANGLE = -44;
  const SCOOT_ROTATION_LIMIT = 70;
  const SPRING_EPSILON = 0.001 * 60;

  const SPRINGS = Object.freeze({
    position: { dampingFraction: 0.9, response: 0.19 },
    rotation: { dampingFraction: 0.9, response: 0.12 },
    progress: { dampingFraction: 0.94, response: 0.19 },
    scootRotation: { dampingFraction: 0.82, response: 0.055 },
    scootStretch: { dampingFraction: 0.86, response: 0.12 },
    stretch: { dampingFraction: 0.85, response: 0.2 },
    visibility: { dampingFraction: 0.86, response: 0.42 },
  });

  const PATH = Object.freeze({
    arcFlow: 0.5783555327868779,
    arcSize: 0.2765523188064277,
    boundsMargin: 20,
    candidateCount: 20,
    clickAngleDegrees: -44,
    endpointHandle: 0.15,
    startHandle: 0.41960295031576633,
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function lerp(start, end, progress) {
    return start + (end - start) * progress;
  }

  function distance(left, right) {
    return Math.hypot(right.x - left.x, right.y - left.y);
  }

  function normalizeVector(vector) {
    const length = Math.hypot(vector.x, vector.y);
    return length < 0.001
      ? { x: 1, y: 0 }
      : { x: vector.x / length, y: vector.y / length };
  }

  function normalizeDegrees(value) {
    const result = value % 360;
    return result < 0 ? result + 360 : result;
  }

  function shortestDegrees(from, to) {
    let delta = to - from;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return delta;
  }

  function setAngularTarget(spring, target) {
    spring.target = spring.value + shortestDegrees(spring.value, target);
  }

  function rounded(value) {
    return Math.round(value * 1000) / 1000;
  }

  function newSpring(value, target, tuning) {
    return {
      dampingFraction: tuning.dampingFraction,
      force: 0,
      response: tuning.response,
      simulationTime: 0,
      scriptTime: 0,
      target,
      value,
      velocity: 0,
    };
  }

  function resetSpring(spring, value) {
    spring.force = 0;
    spring.simulationTime = 0;
    spring.scriptTime = 0;
    spring.target = value;
    spring.value = value;
    spring.velocity = 0;
  }

  function springAtRest(spring) {
    if (
      Math.max(
        spring.velocity * spring.velocity,
        spring.force * spring.force
      ) >
      SPRING_EPSILON * SPRING_EPSILON
    ) {
      return false;
    }
    const tolerance = spring.target * 0.01;
    const error = spring.target - spring.value;
    return tolerance === 0 || error * error <= tolerance * tolerance;
  }

  function advanceSpring(spring, seconds) {
    const response = Math.max(0.001, spring.response);
    const stiffnessLimit = 1 / (2 * SPRING_STEP_SECONDS ** 2);
    const stiffness = Math.min(
      (Math.PI * 2) ** 2 / response ** 2,
      stiffnessLimit
    );
    const damping =
      Math.sqrt(stiffness) * 2 * spring.dampingFraction;

    spring.scriptTime += Math.max(0, seconds);
    if (spring.scriptTime - spring.simulationTime > MAX_CATCHUP_SECONDS) {
      spring.simulationTime = spring.scriptTime - FRAME_SECONDS;
    }

    while (spring.simulationTime < spring.scriptTime) {
      const half = SPRING_STEP_SECONDS / 2;
      const midpointVelocity = spring.velocity + spring.force * half;
      spring.value += midpointVelocity * SPRING_STEP_SECONDS;
      spring.force =
        midpointVelocity * -damping +
        (spring.target - spring.value) * stiffness;
      spring.velocity = midpointVelocity + spring.force * half;
      spring.simulationTime += SPRING_STEP_SECONDS;
    }

    if (springAtRest(spring)) spring.value = spring.target;
  }

  function springFinished(spring) {
    return spring.value === spring.target && springAtRest(spring);
  }

  function directionFromDegrees(degrees) {
    const radians = degrees * (Math.PI / 180);
    return { x: Math.sin(radians), y: -Math.cos(radians) };
  }

  function boundedHandle(bounds, point, direction, requestedLength) {
    let length = requestedLength;
    if (direction.x < 0) {
      length = Math.min(length, point.x / -direction.x);
    } else if (direction.x > 0) {
      length = Math.min(length, (bounds.width - point.x) / direction.x);
    }
    if (direction.y < 0) {
      length = Math.min(length, point.y / -direction.y);
    } else if (direction.y > 0) {
      length = Math.min(length, (bounds.height - point.y) / direction.y);
    }
    const safeLength = Math.max(0, length);
    return {
      x: point.x + direction.x * safeLength,
      y: point.y + direction.y * safeLength,
    };
  }

  function cubicPoint(start, control1, control2, end, progress) {
    const inverse = 1 - progress;
    const startWeight = inverse ** 3;
    const control1Weight = 3 * inverse ** 2 * progress;
    const control2Weight = 3 * inverse * progress ** 2;
    const endWeight = progress ** 3;
    return {
      x:
        start.x * startWeight +
        control1.x * control1Weight +
        control2.x * control2Weight +
        end.x * endWeight,
      y:
        start.y * startWeight +
        control1.y * control1Weight +
        control2.y * control2Weight +
        end.y * endWeight,
    };
  }

  function cubicTangent(start, segment, progress) {
    const inverse = 1 - progress;
    return {
      x:
        3 * inverse ** 2 * (segment.control1.x - start.x) +
        6 *
          inverse *
          progress *
          (segment.control2.x - segment.control1.x) +
        3 * progress ** 2 * (segment.end.x - segment.control2.x),
      y:
        3 * inverse ** 2 * (segment.control1.y - start.y) +
        6 *
          inverse *
          progress *
          (segment.control2.y - segment.control1.y) +
        3 * progress ** 2 * (segment.end.y - segment.control2.y),
    };
  }

  function singleSegmentPath(start, end, startControl, endControl) {
    return {
      arc: null,
      arcIn: null,
      arcOut: null,
      end,
      endControl,
      segments: [{ control1: startControl, control2: endControl, end }],
      start,
      startControl,
    };
  }

  function twoSegmentPath(
    start,
    end,
    startControl,
    endControl,
    arc,
    arcIn,
    arcOut
  ) {
    return {
      arc,
      arcIn,
      arcOut,
      end,
      endControl,
      segments: [
        { control1: startControl, control2: arcIn, end: arc },
        { control1: arcOut, control2: endControl, end },
      ],
      start,
      startControl,
    };
  }

  function addArcCandidate(
    candidates,
    {
      arcDistance,
      arcHandleDistance,
      arcNormal,
      travelDirection,
      clickDirection,
      start,
      end,
      midpoint,
      startControl,
      endControl,
      startControlDistance,
    }
  ) {
    const arc = {
      x:
        midpoint.x +
        arcNormal.x * arcDistance +
        clickDirection.x * startControlDistance * 0.16,
      y:
        midpoint.y +
        arcNormal.y * arcDistance +
        clickDirection.y * startControlDistance * 0.16,
    };
    const arcIn = {
      x: arc.x - travelDirection.x * arcHandleDistance,
      y: arc.y - travelDirection.y * arcHandleDistance,
    };
    const arcOut = {
      x: arc.x + travelDirection.x * arcHandleDistance,
      y: arc.y + travelDirection.y * arcHandleDistance,
    };
    candidates.push(
      twoSegmentPath(
        start,
        end,
        startControl,
        endControl,
        arc,
        arcIn,
        arcOut
      )
    );
  }

  function pathCandidates(bounds, start, end) {
    const clickDirection = directionFromDegrees(PATH.clickAngleDegrees);
    const directDistance = distance(start, end);
    const travelVector = { x: end.x - start.x, y: end.y - start.y };
    const travelDirection = normalizeVector(travelVector);
    const startHandleLength = clamp(
      directDistance * PATH.startHandle,
      48,
      Math.min(640, directDistance * 0.9)
    );
    const endHandleLength = clamp(
      directDistance * PATH.endpointHandle,
      48,
      Math.min(640, directDistance * 0.9)
    );
    const reverseClickDirection = {
      x: -clickDirection.x,
      y: -clickDirection.y,
    };
    const startControl = boundedHandle(
      bounds,
      start,
      clickDirection,
      startHandleLength
    );
    const endControl = boundedHandle(
      bounds,
      end,
      reverseClickDirection,
      endHandleLength
    );
    const perpendicular = {
      x: -travelDirection.y,
      y: travelDirection.x,
    };
    const side =
      perpendicular.x * clickDirection.x +
        perpendicular.y * clickDirection.y >=
      0
        ? 1
        : -1;
    const naturalNormal = {
      x: perpendicular.x * side,
      y: perpendicular.y * side,
    };
    const midpoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };
    const shorterStartControl = boundedHandle(
      bounds,
      start,
      clickDirection,
      startHandleLength * 0.65
    );
    const shorterEndControl = boundedHandle(
      bounds,
      end,
      reverseClickDirection,
      endHandleLength * 0.65
    );
    const candidates = [
      singleSegmentPath(start, end, startControl, endControl),
      singleSegmentPath(
        start,
        end,
        shorterStartControl,
        shorterEndControl
      ),
    ];
    const arcDistance = clamp(
      directDistance * PATH.arcSize,
      50,
      520
    );
    const arcHandleDistance = clamp(
      directDistance * PATH.arcFlow,
      38,
      440
    );

    for (const distanceScale of [0.55, 0.8, 1.05]) {
      for (const handleScale of [0.65, 1, 1.35]) {
        for (const normal of [
          naturalNormal,
          { x: -naturalNormal.x, y: -naturalNormal.y },
        ]) {
          addArcCandidate(candidates, {
            arcDistance: arcDistance * distanceScale,
            arcHandleDistance: arcHandleDistance * handleScale,
            arcNormal: normal,
            travelDirection,
            clickDirection,
            start,
            end,
            midpoint,
            startControl,
            endControl,
            startControlDistance: startHandleLength,
          });
        }
      }
    }
    return candidates.slice(0, PATH.candidateCount);
  }

  function angleDelta(from, to) {
    let delta = to - from;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  function insideBounds(point, bounds, margin) {
    return (
      point.x >= margin &&
      point.x <= bounds.width - margin &&
      point.y >= margin &&
      point.y <= bounds.height - margin
    );
  }

  function pathMetrics(path, bounds = null, margin = 0) {
    let length = 0;
    let angleEnergy = 0;
    let maximumTurn = 0;
    let totalTurn = 0;
    let previousAngle = null;
    let remainsInside =
      bounds === null || insideBounds(path.start, bounds, margin);
    let segmentStart = path.start;
    let previousPoint = path.start;

    for (const segment of path.segments) {
      for (let sample = 1; sample <= 24; sample += 1) {
        const point = cubicPoint(
          segmentStart,
          segment.control1,
          segment.control2,
          segment.end,
          sample / 24
        );
        length += distance(previousPoint, point);
        if (bounds !== null) {
          remainsInside =
            remainsInside && insideBounds(point, bounds, margin);
        }
        const movement = {
          x: point.x - previousPoint.x,
          y: point.y - previousPoint.y,
        };
        if (Math.hypot(movement.x, movement.y) > 0.01) {
          const angle = Math.atan2(movement.y, movement.x);
          if (previousAngle !== null) {
            const turn = angleDelta(previousAngle, angle);
            angleEnergy += turn * turn;
            maximumTurn = Math.max(maximumTurn, Math.abs(turn));
            totalTurn += Math.abs(turn);
          }
          previousAngle = angle;
        }
        previousPoint = point;
      }
      segmentStart = segment.end;
    }

    return {
      angleEnergy,
      length,
      maximumTurn,
      remainsInside,
      totalTurn,
    };
  }

  function reverseTravelPenalty(path) {
    const clickDirection = directionFromDegrees(POINTER_REST_ANGLE);
    const travelDirection = normalizeVector({
      x: path.end.x - path.start.x,
      y: path.end.y - path.start.y,
    });
    return clamp(
      (-(travelDirection.x * clickDirection.x +
        travelDirection.y * clickDirection.y) -
        0.08) /
        0.92,
      0,
      1
    );
  }

  function pathScore(path, metrics) {
    const directDistance = Math.max(1, distance(path.start, path.end));
    const extraLength = Math.max(0, metrics.length / directDistance - 1);
    return (
      metrics.length +
      extraLength * 320 +
      metrics.angleEnergy * 140 +
      metrics.maximumTurn * 180 +
      metrics.totalTurn * 18 +
      reverseTravelPenalty(path) * 90 +
      (path.arc === null ? 0 : 45)
    );
  }

  function choosePath(bounds, start, end) {
    const candidates = pathCandidates(bounds, start, end);
    let bestAny = candidates[0];
    let bestAnyScore = Number.POSITIVE_INFINITY;
    let bestInside = candidates[0];
    let bestInsideScore = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      const metrics = pathMetrics(candidate, bounds, PATH.boundsMargin);
      const score = pathScore(candidate, metrics);
      if (score < bestAnyScore) {
        bestAny = candidate;
        bestAnyScore = score;
      }
      if (metrics.remainsInside && score < bestInsideScore) {
        bestInside = candidate;
        bestInsideScore = score;
      }
    }
    return bestInsideScore === Number.POSITIVE_INFINITY ? bestAny : bestInside;
  }

  function pathPoint(path, progress) {
    const bounded = clamp(progress, 0, 1);
    const scaled =
      bounded === 1
        ? path.segments.length - 1
        : bounded * path.segments.length;
    const index = Math.floor(scaled);
    const segment = path.segments[index];
    const segmentStart =
      index === 0 ? path.start : path.segments[index - 1].end;
    const localProgress = bounded === 1 ? 1 : scaled - index;
    return {
      point: cubicPoint(
        segmentStart,
        segment.control1,
        segment.control2,
        segment.end,
        localProgress
      ),
      tangent: cubicTangent(segmentStart, segment, localProgress),
    };
  }

  function pathSpringTuning(path) {
    const metrics = pathMetrics(path);
    const directDistance = Math.max(1, distance(path.start, path.end));
    const extraLength = Math.max(0, metrics.length / directDistance - 1);
    const distanceWeight = clamp((metrics.length - 180) / 760, 0, 1);
    const extraWeight = clamp(extraLength / 0.55, 0, 1);
    const totalTurnWeight = clamp(metrics.totalTurn / (Math.PI * 1.4), 0, 1);
    const energyWeight = clamp(metrics.angleEnergy / 1.25, 0, 1);
    const complexity = clamp(
      extraWeight * 0.42 +
        totalTurnWeight * 0.38 +
        energyWeight * 0.2,
      0,
      1
    );
    const arcWeight = path.arc === null ? 0 : 0.04;
    const straightScale = path.arc === null ? 1 : 0.9;
    const response = clamp(
      (0.42 +
        distanceWeight * 0.22 +
        complexity * 0.12 +
        reverseTravelPenalty(path) * 0.28 +
        arcWeight) *
        0.7 *
        straightScale,
      0.12,
      2.2
    );
    return { dampingFraction: 0.9, response };
  }

  function pointerAngleForTangent(tangent) {
    if (Math.hypot(tangent.x, tangent.y) < 0.001) {
      return normalizeDegrees(POINTER_REST_ANGLE);
    }
    const unit = normalizeVector(tangent);
    return normalizeDegrees(
      Math.atan2(unit.y, unit.x) * (180 / Math.PI) + 90
    );
  }

  function makeState(point, visible) {
    const visibility = visible ? 1 : 0;
    const restAngle = normalizeDegrees(POINTER_REST_ANGLE);
    return {
      motion: null,
      point,
      positionX: newSpring(point.x, point.x, SPRINGS.position),
      positionY: newSpring(point.y, point.y, SPRINGS.position),
      rotation: restAngle,
      rotationSpring: newSpring(
        restAngle,
        restAngle,
        SPRINGS.rotation
      ),
      scootAxis: 0,
      scootAxisSpring: newSpring(0, 0, SPRINGS.rotation),
      scootRotation: newSpring(0, 0, SPRINGS.scootRotation),
      scootStretch: newSpring(1, 1, SPRINGS.scootStretch),
      stretch: newSpring(1, 1, SPRINGS.stretch),
      thinkingStartedAt: null,
      visibility: newSpring(
        visibility,
        visibility,
        SPRINGS.visibility
      ),
    };
  }

  function resetScoot(state) {
    resetSpring(state.scootAxisSpring, 0);
    resetSpring(state.scootRotation, 0);
    resetSpring(state.scootStretch, 1);
    state.scootAxis = 0;
  }

  function setPointImmediately(state, point) {
    state.point = point;
    resetSpring(state.positionX, point.x);
    resetSpring(state.positionY, point.y);
  }

  function resetAtPoint(state, point) {
    state.motion = null;
    setPointImmediately(state, point);
    resetSpring(
      state.rotationSpring,
      normalizeDegrees(POINTER_REST_ANGLE)
    );
    state.rotation = state.rotationSpring.value;
    resetScoot(state);
    resetSpring(state.stretch, 1);
  }

  function pointReached(state, point) {
    return (
      distance(state.point, point) <= ARRIVAL_DISTANCE &&
      Math.abs(state.positionX.velocity) <= ARRIVAL_SPEED &&
      Math.abs(state.positionY.velocity) <= ARRIVAL_SPEED
    );
  }

  function advancePosition(state, seconds) {
    const previous = state.point;
    advanceSpring(state.positionX, seconds);
    advanceSpring(state.positionY, seconds);
    advanceSpring(state.rotationSpring, seconds);
    advanceSpring(state.scootAxisSpring, seconds);
    const point = {
      x: state.positionX.value,
      y: state.positionY.value,
    };
    const speed =
      distance(previous, point) / Math.max(seconds, SPRING_STEP_SECONDS);
    state.point = point;
    state.rotation = state.rotationSpring.value;
    state.scootAxis = state.scootAxisSpring.value;
    return { point, speed };
  }

  function beginScoot(state, start, end) {
    const direction = normalizeVector({
      x: end.x - start.x,
      y: end.y - start.y,
    });
    const axisRotation =
      Math.hypot(direction.x, direction.y) < 0.001
        ? 0
        : Math.atan2(direction.y, direction.x) * (180 / Math.PI);
    const rotationTarget =
      clamp(direction.x * 0.75 - direction.y * 0.62, -1, 1) *
      SCOOT_ROTATION_LIMIT;

    state.positionX.response = SPRINGS.position.response;
    state.positionY.response = SPRINGS.position.response;
    state.positionX.dampingFraction =
      SPRINGS.position.dampingFraction;
    state.positionY.dampingFraction =
      SPRINGS.position.dampingFraction;
    state.positionX.target = end.x;
    state.positionY.target = end.y;
    setAngularTarget(
      state.rotationSpring,
      normalizeDegrees(POINTER_REST_ANGLE)
    );
    setAngularTarget(state.scootAxisSpring, axisRotation);
    state.motion = {
      axisRotation,
      end,
      mode: "scoot",
      progress: newSpring(0, 1, SPRINGS.progress),
      rotationTarget,
      start,
    };
  }

  function beginBezier(state, start, end, viewport) {
    const path = choosePath(viewport, start, end);
    const tuning = pathSpringTuning(path);
    state.positionX.response = clamp(tuning.response * 0.18, 0.035, 0.12);
    state.positionY.response = state.positionX.response;
    state.positionX.dampingFraction = tuning.dampingFraction;
    state.positionY.dampingFraction = tuning.dampingFraction;
    state.motion = {
      mode: "bezier",
      path,
      progress: newSpring(0, 1, tuning),
    };
  }

  function beginMove(state, end, viewport) {
    state.thinkingStartedAt = null;
    const start = { x: state.point.x, y: state.point.y };
    if (distance(start, end) <= SHORT_MOVE_THRESHOLD) {
      beginScoot(state, start, end);
    } else {
      beginBezier(state, start, end, viewport);
    }
  }

  function projectionProgress(point, start, end) {
    const segment = { x: end.x - start.x, y: end.y - start.y };
    const lengthSquared = segment.x ** 2 + segment.y ** 2;
    if (lengthSquared < 0.001) return 1;
    return clamp(
      ((point.x - start.x) * segment.x +
        (point.y - start.y) * segment.y) /
        lengthSquared,
      0,
      1
    );
  }

  function finishArrival(state, point, angle, timestamp) {
    setPointImmediately(state, point);
    resetSpring(state.rotationSpring, angle);
    state.rotation = angle;
    resetScoot(state);
    resetSpring(state.stretch, 1);
    state.motion = null;
    state.thinkingStartedAt = timestamp;
  }

  function advanceScoot(state, seconds, timestamp) {
    const motion = state.motion;
    advanceSpring(motion.progress, seconds);
    state.positionX.target = motion.end.x;
    state.positionY.target = motion.end.y;
    setAngularTarget(state.scootAxisSpring, motion.axisRotation);
    setAngularTarget(
      state.rotationSpring,
      normalizeDegrees(POINTER_REST_ANGLE)
    );
    const actual = advancePosition(state, seconds);
    const progress = projectionProgress(
      actual.point,
      motion.start,
      motion.end
    );
    const pulse = Math.sin(Math.min(1, progress) * Math.PI);
    state.stretch.target = 1;
    state.scootStretch.target = lerp(
      1,
      lerp(1, 0, pulse),
      0.15
    );
    state.scootRotation.target = motion.rotationTarget * pulse;

    if (
      progress >= 0.999 &&
      Math.abs(motion.progress.velocity) < 0.01 &&
      pointReached(state, motion.end)
    ) {
      finishArrival(
        state,
        motion.end,
        normalizeDegrees(POINTER_REST_ANGLE),
        timestamp
      );
      return true;
    }
    return false;
  }

  function advanceBezier(state, seconds, timestamp) {
    const motion = state.motion;
    state.scootStretch.target = 1;
    state.scootRotation.target = 0;
    advanceSpring(motion.progress, seconds);
    const progress = clamp(motion.progress.value, 0, 1);
    const sampled = pathPoint(motion.path, progress);
    state.positionX.target = sampled.point.x;
    state.positionY.target = sampled.point.y;
    setAngularTarget(
      state.rotationSpring,
      pointerAngleForTangent(sampled.tangent)
    );
    setAngularTarget(state.scootAxisSpring, 0);
    const actual = advancePosition(state, seconds);
    state.stretch.target = clamp(1 - actual.speed / 5500, 0.65, 1);

    if (
      progress >= 0.999 &&
      Math.abs(motion.progress.velocity) < 0.01 &&
      pointReached(state, sampled.point)
    ) {
      const end = pathPoint(motion.path, 1);
      finishArrival(
        state,
        end.point,
        pointerAngleForTangent(end.tangent),
        timestamp
      );
      return true;
    }
    return false;
  }

  function advanceState(state, seconds, timestamp) {
    let arrived = false;
    if (state.motion?.mode === "scoot") {
      arrived = advanceScoot(state, Math.max(0, seconds), timestamp);
    } else if (state.motion?.mode === "bezier") {
      arrived = advanceBezier(state, Math.max(0, seconds), timestamp);
    } else {
      state.stretch.target = 1;
      state.scootStretch.target = 1;
      state.scootRotation.target = 0;
    }
    advanceSpring(state.visibility, seconds);
    advanceSpring(state.stretch, seconds);
    advanceSpring(state.scootStretch, seconds);
    advanceSpring(state.scootRotation, seconds);
    return arrived;
  }

  function thinkingRotation(state, timestamp) {
    if (state.thinkingStartedAt === null) return state.rotation;
    const elapsed = (timestamp - state.thinkingStartedAt) / 1000;
    if (elapsed < 0) return state.rotation;
    const phase = Math.min(1, elapsed / 1.41);
    const envelope = Math.sin(phase * Math.PI);
    const wave = Math.sin((elapsed / 0.66) * Math.PI * 2) * envelope;
    if (phase >= 1) {
      state.thinkingStartedAt = null;
      return state.rotation;
    }
    return state.rotation + wave * 12.5;
  }

  function visualStyle({
    point,
    rotation,
    scootAxis,
    scootRotation,
    scootStretch,
    stretch,
    visibility,
  }) {
    const shown = clamp(visibility, 0, 1);
    const visibilityScale = lerp(HIDDEN_SCALE, 1, shown);
    const blur = lerp(HIDDEN_BLUR, 0, shown);
    const compressed = clamp(scootStretch, 0, 1);
    const transforms = [
      `translate3d(${rounded(point.x - POINTER_CENTER)}px, ${rounded(
        point.y - POINTER_CENTER
      )}px, 0)`,
    ];
    if (
      Math.abs(shortestDegrees(0, scootAxis)) > 0.001 ||
      Math.abs(compressed - 1) > 0.001
    ) {
      transforms.push(
        `rotate(${rounded(scootAxis)}deg)`,
        `scale(1, ${rounded(compressed)})`,
        `rotate(${rounded(-scootAxis)}deg)`
      );
    }
    transforms.push(
      `rotate(${rounded(
        normalizeDegrees(rotation + scootRotation)
      )}deg)`,
      `scale(${rounded(stretch * visibilityScale)}, ${rounded(
        visibilityScale
      )})`
    );
    return {
      filter: `blur(${rounded(blur)}px)`,
      opacity: `${rounded(shown)}`,
      transform: transforms.join(" "),
    };
  }

  function motionActive(state) {
    return (
      state.motion !== null ||
      state.thinkingStartedAt !== null ||
      !springFinished(state.positionX) ||
      !springFinished(state.positionY) ||
      !springFinished(state.rotationSpring) ||
      !springFinished(state.scootAxisSpring) ||
      !springFinished(state.scootRotation) ||
      !springFinished(state.scootStretch) ||
      !springFinished(state.stretch) ||
      !springFinished(state.visibility)
    );
  }

  function createElements(root, glowColor) {
    const layer = document.createElement("div");
    Object.assign(layer.style, {
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
      position: "absolute",
      zIndex: "20",
    });

    const cursor = document.createElement("div");
    cursor.dataset.testid = "browser-agent-cursor";
    Object.assign(cursor.style, {
      height: "24px",
      left: "0",
      position: "absolute",
      top: "0",
      transformOrigin: "12px 12px",
      willChange: "transform",
      width: "24px",
    });

    const inner = document.createElement("div");
    inner.style.transform = "translate3d(12px, -2.5px, 0)";

    const image = document.createElement("img");
    image.alt = "";
    image.dataset.browserAgentCursorAsset = "";
    image.dataset.testid = "browser-agent-cursor-asset";
    image.draggable = false;
    image.height = 24;
    image.src = ASSET_DATA_URL;
    Object.assign(image.style, {
      display: "block",
      filter:
        "drop-shadow(0 0 6px color-mix(in srgb, var(--browser-agent-cursor-glow-color) 90%, transparent)) drop-shadow(0 0 15px color-mix(in srgb, var(--browser-agent-cursor-glow-color) 48%, transparent))",
      transform: "rotate(44deg) scale(1)",
      transformOrigin: "0 0",
    });
    image.style.setProperty(
      "--browser-agent-cursor-glow-color",
      glowColor
    );
    image.width = 23;

    inner.appendChild(image);
    cursor.appendChild(inner);
    layer.appendChild(cursor);
    root.appendChild(layer);
    return { cursor, layer };
  }

  function createRenderer(
    root,
    {
      glowColor = "#339cff",
      onArrived = null,
      requestFrame = (callback) => window.requestAnimationFrame(callback),
      cancelFrame = (id) => window.cancelAnimationFrame(id),
      clock = () =>
        typeof performance === "undefined" ? Date.now() : performance.now(),
    } = {}
  ) {
    const elements = createElements(root, glowColor);
    let frame = null;
    let lastTimestamp = clock();
    let state = null;
    let destroyed = false;
    let forceFrame = false;
    let pendingSequence = null;
    let pendingArrivalKey = null;
    let lastArrivalKey = null;
    let previousTurnKey = null;
    let firstVisibleTurn = null;

    function render(timestamp = clock()) {
      if (state === null) return;
      const style = visualStyle({
        point: state.point,
        rotation: thinkingRotation(state, timestamp),
        scootAxis: state.scootAxis,
        scootRotation: state.scootRotation.value,
        scootStretch: state.scootStretch.value,
        stretch: state.stretch.value,
        visibility: state.visibility.value,
      });
      elements.cursor.style.transform = style.transform;
      elements.cursor.style.opacity = style.opacity;
      elements.cursor.style.filter = style.filter;
    }

    function acknowledgeArrival() {
      if (
        pendingSequence === null ||
        pendingArrivalKey === null ||
        pendingArrivalKey === lastArrivalKey
      ) {
        return;
      }
      lastArrivalKey = pendingArrivalKey;
      onArrived?.(pendingSequence);
    }

    function schedule() {
      if (
        frame !== null ||
        state === null ||
        destroyed ||
        !motionActive(state)
      ) {
        return;
      }
      frame = requestFrame((timestamp) => {
        frame = null;
        if (state === null || destroyed) return;
        const seconds = forceFrame
          ? FRAME_SECONDS
          : Math.max(FRAME_SECONDS, (timestamp - lastTimestamp) / 1000);
        forceFrame = false;
        lastTimestamp = timestamp;
        const arrived = advanceState(state, seconds, timestamp);
        render(timestamp);
        if (arrived) acknowledgeArrival();
        schedule();
      });
    }

    return {
      destroy() {
        destroyed = true;
        if (frame !== null) cancelFrame(frame);
        frame = null;
        elements.layer.remove();
      },

      setState(next) {
        const turnKey = next.turnKey ?? "";
        const cursor = next.cursor ?? null;
        const hasCursor = cursor !== null;
        const viewport = next.viewportSize;
        const point = {
          x: clamp(
            cursor?.x ?? Math.round(viewport.width * 0.58),
            0,
            viewport.width
          ),
          y: clamp(
            cursor?.y ?? Math.round(viewport.height * 0.55),
            0,
            viewport.height
          ),
        };
        const visible =
          next.isVisible !== false && cursor?.visible !== false;
        const animate = cursor?.animateMovement !== false;
        const implicitThinking = visible && !hasCursor;

        pendingSequence = cursor?.moveSequence ?? null;
        pendingArrivalKey =
          pendingSequence === null
            ? null
            : `${turnKey}:${pendingSequence}`;

        if (state === null) state = makeState(point, visible);
        state.visibility.target = visible ? 1 : 0;

        if (implicitThinking && previousTurnKey !== turnKey) {
          previousTurnKey = turnKey;
          resetSpring(state.visibility, 1);
          state.thinkingStartedAt = clock();
        }

        if (!hasCursor) {
          resetAtPoint(state, point);
          render();
          schedule();
          return;
        }

        const firstShownMove =
          cursor?.moveSequence !== undefined &&
          visible &&
          state.visibility.value <= 0.001 &&
          firstVisibleTurn !== turnKey;
        state.thinkingStartedAt = null;
        const moveDistance = distance(state.point, point);

        if (!animate || firstShownMove || moveDistance < 0.5) {
          if (firstShownMove) {
            firstVisibleTurn = turnKey;
            resetSpring(state.visibility, 1);
          }
          resetAtPoint(state, point);
          if (!animate) {
            state.stretch.force = 0;
            state.stretch.value = 1;
            state.stretch.velocity = 0;
          }
          render();
          acknowledgeArrival();
          schedule();
          return;
        }

        beginMove(state, point, viewport);
        forceFrame = true;
        render();
        schedule();
      },
    };
  }

  globalThis.MidasCursorMotion = Object.freeze({
    ASSET_DATA_URL,
    PATH,
    SPRINGS,
    choosePath,
    createRenderer,
    pathPoint,
    visualStyle,
  });
})();
