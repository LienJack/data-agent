/** Data-free Python implementation, executed only by the model's original policy-checked Cell. */
export const PANEL_RATIO_PREPARATION_REFERENCE = `def prepare_ratio_rollup(observations, mapping):
    time_key = mapping['time_output']
    periods = sorted(set(row[time_key] for row in observations))
    assert len(periods) == 2, 'RATIO_PERIODS_INVALID'
    before_period, after_period = periods

    def total(rows, column):
        if not rows:
            return None
        value = 0.0
        for row in rows:
            if row[column] is None:
                return None
            value += float(row[column])
        assert math.isfinite(value), 'RATIO_TOTAL_RANGE_INVALID'
        return value

    def at(rows, period):
        selected = [row for row in rows if row[time_key] == period]
        numerator = total(selected, mapping['numerator_output'])
        denominator = total(selected, mapping['denominator_output'])
        ratio = None
        if numerator is not None and denominator is not None and denominator != 0:
            ratio = (numerator - (denominator if mapping['numerator_adjustment'] == 'SUBTRACT_DENOMINATOR' else 0)) / denominator
        return {'numerator': numerator, 'denominator': denominator, 'ratio': ratio}

    def compare(rows):
        before, after = at(rows, before_period), at(rows, after_period)
        denominator_change = None if before['denominator'] is None or after['denominator'] is None else after['denominator'] - before['denominator']
        ratio_change = None if before['ratio'] is None or after['ratio'] is None else after['ratio'] - before['ratio']
        return {'from': before, 'to': after, 'denominator_change': denominator_change, 'ratio_change': ratio_change}

    axes = []
    category_keys = [category['dimension_output'] for category in mapping['categories']]
    for axis in mapping['categories']:
        parents = {}
        for row in observations:
            value = row[axis['dimension_output']]
            if value not in parents:
                parents[value] = []
            parents[value].append(row)
        groups = []
        for value, rows in parents.items():
            parent = compare(rows)
            selected = (parent['from']['denominator'] is not None and parent['from']['denominator'] > 0
                        and parent['to']['denominator'] is not None and parent['to']['denominator'] > 0
                        and parent['denominator_change'] is not None and parent['denominator_change'] > 0
                        and parent['ratio_change'] is not None and parent['ratio_change'] < 0)
            tuples = {}
            if selected:
                for row in rows:
                    key = tuple(row[column] for column in category_keys)
                    if key not in tuples:
                        tuples[key] = []
                    tuples[key].append(row)
            children = [{'group': dict(zip(category_keys, key)), **compare(child_rows)} for key, child_rows in tuples.items()]
            groups.append({'value': value, **parent, 'selected': selected, 'children': children})
        axes.append({**axis, 'groups': groups})
    return {'basis': 'SUM_BEFORE_RATIO', 'from_period': before_period, 'to_period': after_period,
            'numerator_output': mapping['numerator_output'], 'denominator_output': mapping['denominator_output'],
            'ratio_output': mapping['ratio_output'], 'numerator_adjustment': mapping['numerator_adjustment'], 'axes': axes}
`;
