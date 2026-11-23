import { Vector3 } from 'three';

export class CasDirector {
  constructor(plan) {
    this.plan = plan;
    this.primary = { state: 'active', label: plan.primary };
    this.secondary = { state: 'pending', label: plan.secondary };
    this.contacts = new Map();
    this.requests = [];
    this.history = [];
    this.next = 0;
    this.hold = 0;
    this.selected = null;
    this.phase = 'Approach';
    this.reinforcement = 'pending';
    this.revision = 0;
    this.reportedThreats = new Set();
    this.incidents = new Set();
    this.radio(0, 'Control', plan.primary + '.');
  }

  radio(time, sender, message) {
    this.history.push({ time, sender, message });
    if (this.history.length > 24) this.history.shift();
    this.revision++;
  }

  remember(unit, point, time, source) {
    if (unit.faction === 'friendly' || unit.arrived) return;
    const old = this.contacts.get(unit.id);
    if (old && (old.time > time || old.time === time && old.source === source || old.source === 'Visual' && source === 'Ground report' && time - old.time < 4)) return;
    const classification = source === 'Ground report' && this.plan.difficulty === 'veteran' ? 'Unidentified vehicle' : unit.classification;
    if (!old && unit.faction === 'opposing' && !this.reportedThreats.has(unit.id)) {
      this.reportedThreats.add(unit.id);
      this.radio(time, 'Recon', `${source === 'Visual' ? 'Visual contact' : 'Ground contact'}: ${classification.toLowerCase()} reported.`);
    }
    const position = old?.position ?? new Vector3();
    position.copy(point);
    if (source !== 'Visual') {
      const grid = this.plan.rules.grid;
      position.x = Math.round(position.x / grid) * grid;
      position.z = Math.round(position.z / grid) * grid;
    }
    this.contacts.set(unit.id, {
      id: unit.id, faction: unit.faction, classification, position, time, source,
      label: classification, approximate: true,
      confidence: source === 'Visual' ? 'confirmed' : 'reported',
    });
  }

  update(battle) {
    const { time, targets } = battle;
    if (time < this.next) return;
    const seconds = Math.min(.5, time - this.next + .35);
    this.next = time + .35;
    const { plan } = this;
    if (this.reinforcement === 'pending' && time >= plan.reliefAt) {
      const active = targets.filter((unit) => unit.active && !unit.arrived).length;
      if (active + plan.relief.length <= plan.activeLimit && plan.relief.every((unit) => !battle.occupiedAt(unit, unit.x, unit.z, 5))) {
        battle.spawn(plan.relief);
        this.reinforcement = 'arrived';
        this.radio(time, 'Control', plan.key === 'emergency' ? 'Friendly relief vehicles have entered the sector.' : 'An enemy relief column may be entering the sector.');
      } else if (time > plan.reliefAt + 12) this.reinforcement = 'cancelled';
    }

    const friendly = targets.filter((unit) => unit.faction === 'friendly' && unit.active && !unit.arrived);
    const closeToZone = ({ position }) => (position.x - plan.objective.x) ** 2 + (position.z - plan.objective.z) ** 2
      <= (plan.key === 'emergency' ? 385 : plan.objective.radius) ** 2;
    let threat;
    let reporter;
    let highest = 0;
    for (const unit of friendly) {
      if (!unit.lineOfSight || !unit.track?.active || time - unit.observedAt > 1.1) continue;
      const seen = unit.track;
      this.remember(seen, unit.observed, unit.observedAt, 'Ground report');
      const urgency = (unit.objective === 'deliver' ? 4 : plan.key === 'emergency' ? 3 : closeToZone(unit) ? 2 : 1)
        + Number(seen.type === 'tank');
      if (seen.canFight && unit.position.distanceToSquared(unit.observed) < (seen.spec.weapon.range * 1.16) ** 2
        && urgency > highest && !this.requests.some((request) => request.target === seen.id)) {
        threat = seen;
        reporter = unit;
        highest = urgency;
      }
    }
    if (threat && this.requests.filter((item) => item.state === 'active').length < 2) {
      const contact = this.contacts.get(threat.id);
      const grid = plan.rules.grid;
      const x = Math.round(contact.position.x / grid) * grid;
      const z = Math.round(contact.position.z / grid) * grid;
      const request = {
        id: `support-${this.requests.length + 1}`, state: 'active', accepted: false, target: contact.id,
        position: new Vector3(x, reporter.world.heightAt(x, z) + 3, z),
        classification: contact.classification, confidence: contact.confidence, approximate: true,
        label: highest >= 3 || plan.key === 'protection' ? 'Urgent support area' : 'Priority support area', objective: plan.objective.label,
        requester: reporter.id, urgency: highest >= 3 || plan.key === 'protection' ? 'Urgent' : 'Priority', deadline: time + plan.rules.request,
      };
      this.requests.push(request);
      const encounter = reporter.objective === 'deliver' ? 'Convoy under attack. ' : '';
      this.radio(time, 'Ground', `${encounter}${request.urgency} support requested near ${request.objective}. ${request.classification} reported.`);
    }
    for (const [id, contact] of this.contacts) if (time - contact.time > plan.rules.intelAge) this.contacts.delete(id);
    for (const request of this.requests) {
      if (request.state !== 'active') continue;
      const unit = targets.find(({ id }) => id === request.target);
      const source = targets.find(({ id }) => id === request.requester);
      const stranded = unit.disabled && source.position.distanceToSquared(unit.position) > (unit.spec.weapon?.range ?? 0) ** 2;
      if (!unit.canFight || stranded) this.completeRequest(battle, request);
      else if (!source.active || source.arrived || unit.arrived || time >= request.deadline) {
        request.state = 'cancelled';
        this.radio(time, 'Ground', time >= request.deadline ? 'Support window expired.' : 'Support request withdrawn.');
      }
    }
    if (this.phase === 'Approach' && (highest || time >= 18)) {
      this.phase = 'Engagement';
      if (this.secondary.state === 'pending') this.secondary.state = 'active';
    }
    if (this.phase === 'Engagement' && (this.hold > 3 || this.reinforcement === 'arrived')) this.phase = 'Resolution';

    const mobile = friendly.filter((unit) => !unit.disabled && unit.type !== 'truck');
    const opposing = targets.filter((unit) => unit.faction === 'opposing' && unit.canFight && !unit.arrived);
    if (plan.targets.length) {
      const column = targets.filter((unit) => plan.targets.includes(unit.id));
      const arrived = column.filter((unit) => unit.arrived).length;
      const stopped = column.filter((unit) => unit.disabled).length;
      const protection = plan.key === 'protection';
      const total = column.length;
      const required = plan.rules.transfer;
      this.progress = `${protection ? arrived : stopped} / ${total} transports ${protection ? 'delivered' : 'stopped'} · ${required} required`;
      const requiredScore = protection ? arrived : stopped;
      const losses = protection ? stopped : arrived;
      if (requiredScore >= required) {
        this.secondary.state = requiredScore === total ? 'completed' : 'active';
        if (requiredScore + losses === total || time >= plan.timeLimit || requiredScore === total) {
          battle.finish('win', protection ? `${arrived} transports reached the checkpoint.` : `${stopped} transports were stopped before the front.`);
        }
      } else if (total - losses < required || time >= plan.timeLimit) {
        battle.finish('loss', protection ? 'The convoy could not deliver enough transports.' : 'The column reached the front or outlasted the interception window.');
      }
    } else if (plan.key === 'emergency') {
      const group = friendly.filter((unit) => unit.objective === 'assault');
      const viable = group.filter((unit) => unit.canFight || !unit.disabled).length;
      const threats = opposing.filter(closeToZone).length;
      this.hold = threats <= (plan.difficulty === 'rookie' ? 2 : 1) ? this.hold + seconds : 0;
      this.progress = `${viable} friendly vehicles operational · ${Math.min(12, Math.floor(this.hold))} / 12 s relieved`;
      if (viable < plan.rules.survival) battle.finish('loss', 'The surrounded group became combat ineffective.');
      else if (time >= 14 && this.hold >= 12) {
        this.secondary.state = viable === plan.definitions.filter((unit) => unit.objective === 'assault').length ? 'completed' : 'failed';
        battle.finish('win', `The friendly group held with ${viable} operational vehicles.`);
      } else if (time >= plan.timeLimit) battle.finish('loss', 'The friendly group remained under pressure.');
    } else {
      const inside = mobile.filter(closeToZone).length;
      const defenders = opposing.filter(closeToZone).length;
      this.hold = inside >= plan.rules.survival && inside > defenders ? this.hold + seconds : Math.max(0, this.hold - seconds * .6);
      this.progress = `${Math.min(16, Math.floor(this.hold))} / 16 s control of the crossing`;
      if (this.hold >= 16) {
        this.secondary.state = mobile.length >= 3 ? 'completed' : 'failed';
        battle.finish('win', `Friendly forces secured the crossing with ${mobile.length} mobile combat vehicles.`);
      } else if (mobile.length < plan.rules.survival || time >= plan.timeLimit) battle.finish('loss', 'Friendly forces could not secure the crossing.');
    }
    this.revision++;
  }

  accept(id, time) {
    const request = this.requests.find((item) => item.id === id && item.state === 'active');
    if (!request) return;
    this.selected = request.id;
    if (!request.accepted) {
      request.accepted = true;
      this.radio(time, 'Flight', 'Support request accepted. Area marked.');
    }
    return request;
  }

  select(id) {
    this.selected = id;
    this.revision++;
  }

  designation(battle) {
    const request = this.requests.find((item) => item.id === this.selected && item.state === 'active');
    if (request) return request;
    const contact = this.contacts.get(this.selected);
    if (contact) return contact;
    if (this.selected === 'objective') return this.zoneMarker ??= { position: new Vector3(this.plan.objective.x,
      battle.world.heightAt(this.plan.objective.x, this.plan.objective.z) + 2, this.plan.objective.z), label: this.plan.objective.label };
    return null;
  }

  damageEvent(battle, unit, hit, destroyed) {
    if (hit.amount <= 0 || hit.source !== 'player') return;
    if (unit.faction === 'friendly') {
      const first = !this.incidents.has(unit.id);
      this.incidents.add(unit.id);
      if (first || destroyed) this.radio(battle.time, 'Ground', destroyed
        ? `Friendly ${unit.classification.toLowerCase()} lost to friendly fire.` : 'Friendly fire. Confirm identification before release.');
    } else if (!unit.canFight) {
      for (const request of this.requests) {
        if (request.target === unit.id && request.state === 'active') this.completeRequest(battle, request);
      }
    }
  }

  completeRequest(battle, request) {
    request.state = 'completed';
    this.radio(battle.time, 'Ground', 'Reported threat stopped.');
  }

  finish(battle, outcome, reason) {
    this.primary.state = outcome === 'win' ? 'completed' : 'failed';
    if (this.secondary.state !== 'completed') this.secondary.state = outcome === 'win' ? 'failed' : 'cancelled';
    this.phase = 'Debrief';
    for (const request of this.requests) if (request.state === 'active') request.state = 'cancelled';
    this.radio(battle.time, 'Control', reason);
  }
}
