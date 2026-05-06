// GEOG 485 Final Project - US Disaster Declarations
// Main JavaScript file

//set dimensions for the SVG
const width = 960;
const height = 600;

let disastersCountByCounty; // to hold the rolled-up data for easy access in color function
let disastersTypeByCounty;
let disastersCount;
let disastersType;
let map;
let geoJsonLayer; // Store reference to update styles
let classificationMode = "quantile";

function getColor(countyFips, year) {
    const countyData = disastersCountByCounty.get(countyFips);
    if (!countyData) return "#ccc";
    const value = countyData.get(year) || 0;
    const normalizedValue = classifyQauntValue(value, ClassifyStats);

    return d3.scaleSequential()
        .domain([0, 3]) // Normalized scale (most values fall within 0-3 std devs)
        .interpolator(d3.interpolateReds)(normalizedValue);
}

function getStyle(feature, year) {
    return {
        fillColor: getColor(feature.id, year),
        weight: 2,
        opacity: 1,
        color: '#fff',
        dashArray: '3',
        fillOpacity: 0.9
    };
}

// -- EQUAL INTERVAL --
function computeEqualIntervalStats(values) {
    return {
        min: d3.min(values),
        max: d3.max(values)
    };
}

// -- QUANTILE CLASSIFICATION -- 
function calculateQuantileStats(countyMap, startYear, endYear) {
    const allValues = [];

    countyMap.forEach((yearMap) => {
        let total = 0;

        for (let year = startYear; year <= endYear; year++) {
            total += yearMap.get(year) || 0;
        }

        const avgAnnual = total / (endYear - startYear + 1);
        allValues.push(avgAnnual);
    });

    allValues.sort((a, b) => a - b);

    const n = allValues.length;

    return {
        q0: allValues[0],
        q1: allValues[Math.floor(n * 0.2)],
        q2: allValues[Math.floor(n * 0.4)],
        q3: allValues[Math.floor(n * 0.6)],
        q4: allValues[Math.floor(n * 0.8)],
        q5: allValues[n - 1]
    };
}

function classifyQauntValue(value, stats) {
    // Classify into 5 quantile categories (quintiles)
    if (value == 0) {
        return 0; // Zero - white
    } else if (value <= stats.q1) {
        return 1; // 1st quintile
    } else if (value <= stats.q2) {
        return 2; // 2nd quintile
    } else if (value <= stats.q3) {
        return 3; // 3rd quintile
    } else if (value <= stats.q4) {
        return 4; // 4th quintile
    } else {
        return 5; // 5th quintile (highest)
    }
}

function getColorForClass(classValue) {
    const colors = [
        "#FFFFFF", // Zero - white
        "#ffffcc", // 1st quintile - lightest
        "#fee77e", // 2nd quintile
        "#ffc934", // 3rd quintile
        "#ff9c19", // 4th quintile
        "#ff6010"  // 5th quintile - darkest
    ];
    return colors[classValue];
}

function normalizeByYears(disasterCount, years) {
    // Calculate rate: disasters per square mile
    if (years === 0 || years === undefined) return 0;
    return disasterCount / years;
}

//Classify the county's value based on selected classification mode
function classifyValue(value, stats, mode) {
    if (value === 0) return 0;

    if (mode === "jenks") {
        const b = stats.breaks;

        for (let i = 1; i < b.length; i++) {
            if (value <= b[i]) return i;
        }
        return b.length - 1;
    }

    if (mode === "equal") {
        const step = (stats.max - stats.min) / 5;

        if (value <= stats.min + step) return 1;
        if (value <= stats.min + 2 * step) return 2;
        if (value <= stats.min + 3 * step) return 3;
        if (value <= stats.min + 4 * step) return 4;
        return 5;
    }

    // quantile
    if (value <= stats.q1) return 1;
    if (value <= stats.q2) return 2;
    if (value <= stats.q3) return 3;
    if (value <= stats.q4) return 4;
    return 5;
}

//Create classification stats based on current classification mode
function buildStats(values, mode) {
    if (mode === "equal") {
        return computeEqualIntervalStats(values);
    }

    if (mode === "jenks") {
        //calculate breaks
        const breaks = ss.jenks(values, 5);

        return {
            breaks: breaks
        };
    }

    // quantile fallback
    const sorted = values.slice().sort((a, b) => a - b);
    const n = sorted.length;

    return {
        min: sorted[0],
        q1: sorted[Math.floor(n * 0.2)],
        q2: sorted[Math.floor(n * 0.4)],
        q3: sorted[Math.floor(n * 0.6)],
        q4: sorted[Math.floor(n * 0.8)],
        max: sorted[n - 1]
    };
}

let ClassifyStats;

//Append tool tip to page
var div = d3.select("body")
    .append("div")
    .attr("class", "tooltip")
    .style("opacity", 0);


//Load data and initialize the map
Promise.all([
    d3.json("data/counties-albers-10m.json"),  // Change to the pre-projected TopoJSON
    d3.csv("data/us_disaster_declarations.csv")
]).then(([topoData, data]) => {
    console.log("topoData:", topoData);
    console.log("data:", data);

    // Define the Albers projection for proj4
    proj4.defs("EPSG:102003", "+proj=aea +lat_1=29.5 +lat_2=45.5 +lat_0=37.5 +lon_0=-96 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs");

    // Convert TopoJSON to GeoJSON
    let geoData = topojson.feature(topoData, topoData.objects.counties);

    // Reproject from Albers (projected meters) back to lat/lon
    geoData = {
        ...geoData,
        features: geoData.features.map(feature => ({
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: reprojectCoordinates(feature.geometry.coordinates, feature.geometry.type)
            }
        }))
    };

    function reprojectCoordinates(coords, type) {
        if (type === 'Polygon') {
            return coords.map(ring => ring.map(coord => {
                const result = proj4('EPSG:102003', 'EPSG:4326', coord);
                return [result[0], -result[1]];  // Negate latitude
            }));
        } else if (type === 'MultiPolygon') {
            return coords.map(polygon => polygon.map(ring => ring.map(coord => {
                const result = proj4('EPSG:102003', 'EPSG:4326', coord);
                return [result[0], -result[1]];  // Negate latitude
            })));
        }
        return coords;
    }

    // Initialize the map without custom CRS
    map = L.map('choropleth');

    //Add north arrow
    const north = L.control({ position: "topleft" });

    north.onAdd = function () {
        const div = L.DomUtil.create("div", "north-arrow");
        div.innerHTML = `
        <div style="
            text-align:center;
            font-size:18px;
            font-weight:bold;
            background:white;
            padding:4px 6px;
            border:1px solid #666;
            border-radius:4px;
        ">
            ↑<br>N
        </div>
    `;
        return div;
    };

    north.addTo(map);

    data.forEach(d => {
        d.year = new Date(d.declaration_date).getFullYear();
    });

    // Map of state abbreviations to full names for easier joining with GeoJSON
    const stateMap = {
        "NM": "New Mexico",
        "CA": "California",
        "TX": "Texas",
        "FL": "Florida",
        "NY": "New York",
        "LA": "Louisiana",
        "IL": "Illinois",
        "GA": "Georgia",
        "PA": "Pennsylvania",
        "OH": "Ohio",
        "MI": "Michigan",
        "NC": "North Carolina",
        "VA": "Virginia",
        "WA": "Washington",
        "AZ": "Arizona",
        "MA": "Massachusetts",
        "IN": "Indiana",
        "TN": "Tennessee",
        "MO": "Missouri",
        "MD": "Maryland",
        "WI": "Wisconsin",
        "MN": "Minnesota",
        "CO": "Colorado",
        "AL": "Alabama",
        "SC": "South Carolina",
        "KY": "Kentucky",
        "OR": "Oregon",
        "OK": "Oklahoma",
        "CT": "Connecticut",
        "IA": "Iowa",
        "UT": "Utah",
        "NV": "Nevada",
        "AR": "Arkansas",
        "MS": "Mississippi",
        "KS": "Kansas",
        "NE": "Nebraska",
        "WV": "West Virginia",
        "ID": "Idaho",
        "HI": "Hawaii",
        "NH": "New Hampshire",
        "ME": "Maine",
        "RI": "Rhode Island",
        "VT": "Vermont",
        "DE": "Delaware",
        "AK": "Alaska",
        "WY": "Wyoming",
        "MT": "Montana",
        "ND": "North Dakota",
        "SD": "South Dakota",
        "NJ": "New Jersey"
    };

    const typeColorScale = d3.scaleOrdinal()
        .domain([
            "Biological",
            "Chemical",
            "Coastal Storm",
            "Dam/Levee Break",
            "Drought",
            "Earthquake",
            "Fire",
            "Fishing Losses",
            "Flood",
            "Freezing",
            "Human Cause",
            "Hurricane",
            "Mud/Landslide",
            "Other",
            "Severe Ice Storm",
            "Severe Storm",
            "Snowstorm",
            "Straight-Line Winds",
            "Terrorist",
            "Tornado",
            "Toxic Substances",
            "Tropical Depression",
            "Tropical Storm",
            "Tsunami",
            "Typhoon",
            "Volcanic Eruption",
            "Winter Storm"
        ])
        .range([
            "#1f77b4", // Biological - blue
            "#ff7f0e", // Chemical - orange
            "#2ca02c", // Coastal Storm - green
            "#e377c2", // Dam/Levee Break - pink
            "#9467bd", // Drought - purple
            "#8c564b", // Earthquake - brown
            "#d62728", // Fire - red
            "#7f7f7f", // Fishing Losses - gray
            "#b5cf6b", // Flood - lime
            "#17becf", // Freezing - cyan
            "#ffbb78", // Human Cause - light orange
            "#AEC7E8", // Hurricane - light blue
            "#98df8a", // Mud/Landslide - light green
            "#ff9896", // Other - light red
            "#c5b0d5", // Severe Ice Storm - light purple
            "#c49c94", // Severe Storm - light brown
            "#f7b6d2", // Snowstorm - light pink
            "#DBBD22", // Straight-Line Winds - gold
            "#c7c7c7", // Terrorist - light gray
            "#ff0000", // Tornado - bright red
            "#393B79", // Toxic Substances - dark blue
            "#9EDAE5", // Tropical Depression - light cyan
            "#5254a3", // Tropical Storm - indigo
            "#636363", // Tsunami - dark gray
            "#87CEFA", // Typhoon - sky blue
            "#de9ed6", // Volcanic Eruption - magenta
            "#3182bd"  // Winter Storm - navy
        ]);

    // Aggregate disasters by county FIPS code and year
    disastersCountByCounty = d3.rollup(
        data,
        v => v.length,
        d => d.fips, // Use FIPS code from disaster data
        d => d.year
    );

    ClassifyStats = calculateQuantileStats(disastersCountByCounty, 1953, 2025);

    disastersTypeByCounty = d3.group(
        data,
        d => d.fips,
        d => d['incident_type'],
        d => d.year
    );

    disastersCount = d3.rollup(
        data,
        v => v.length,
        d => stateMap[d.state], // map state abbreviations to full names
        d => d.year
    );

    disastersType = d3.group(
        data,
        d => stateMap[d.state], // map state abbreviations to full names
        d => d['incident_type'],
        d => d.year
    );

    geoJsonLayer = L.geoJson(geoData, {
        style: feature => getStyle(feature, 2000),
        onEachFeature: (feature, layer) => {
            layer.on('mouseout', function () {
                div.transition()
                    .duration(200)
                    .style("opacity", 0);
            });

            layer.on('mouseover', function (e) {
                const sliderInstance = $("#rangeSlider").data("ionRangeSlider");
                const startYear = sliderInstance.result.from;
                const endYear = sliderInstance.result.to;
                const countyData = disastersCountByCounty.get(feature.id);
                //const censusArea = feature.properties.CENSUSAREA;
                let totalDisasters = 0;

                if (countyData) {
                    for (let year = startYear; year <= endYear; year++) {
                        totalDisasters += countyData.get(year) || 0;
                    }
                }

                const rate = normalizeByYears(totalDisasters, (endYear - startYear) + 1);
                const countyName = feature.properties.name;

                div.transition()
                    .duration(200)
                    .style("opacity", 0.9);
                div.html(`<strong>${countyName}</strong><br/>Rate: ${rate.toFixed(4)} disasters/year`)
                    .style("left", (e.originalEvent.pageX + 5) + "px")
                    .style("top", (e.originalEvent.pageY - 28) + "px");
            });

            layer.on('click', function (e) {
                const sliderInstance = $("#rangeSlider").data("ionRangeSlider");
                const startYear = sliderInstance.result.from;
                const endYear = sliderInstance.result.to;
                const countyFips = feature.id;

                // Extract state FIPS code from county FIPS (first 2 digits)
                const stateFips = countyFips.substring(0, 2);

                // Create a map of state FIPS to state names for reference
                const stateFipsMap = {
                    "01": "Alabama", "02": "Alaska", "04": "Arizona", "05": "Arkansas",
                    "06": "California", "08": "Colorado", "09": "Connecticut", "10": "Delaware",
                    "12": "Florida", "13": "Georgia", "15": "Hawaii", "16": "Idaho",
                    "17": "Illinois", "18": "Indiana", "19": "Iowa", "20": "Kansas",
                    "21": "Kentucky", "22": "Louisiana", "23": "Maine", "24": "Maryland",
                    "25": "Massachusetts", "26": "Michigan", "27": "Minnesota", "28": "Mississippi",
                    "29": "Missouri", "30": "Montana", "31": "Nebraska", "32": "Nevada",
                    "33": "New Hampshire", "34": "New Jersey", "35": "New Mexico", "36": "New York",
                    "37": "North Carolina", "38": "North Dakota", "39": "Ohio", "40": "Oklahoma",
                    "41": "Oregon", "42": "Pennsylvania", "44": "Rhode Island", "45": "South Carolina",
                    "46": "South Dakota", "47": "Tennessee", "48": "Texas", "49": "Utah",
                    "50": "Vermont", "51": "Virginia", "53": "Washington", "54": "West Virginia",
                    "55": "Wisconsin", "56": "Wyoming"
                };

                const state = stateFipsMap[stateFips];
                const stateData = disastersType.get(state);
                const countyData = disastersTypeByCounty.get(countyFips);

                // Update the pie chart title
                d3.select("#pieChartTitle").text(`${state} (${startYear} - ${endYear})`);

                if (!stateData) {
                    console.log("No disasters for state", state);
                    return;
                }

                const flattened = [];

                stateData.forEach((yearMap, type) => {
                    yearMap.forEach((records, yr) => {
                        records.forEach(record => {
                            flattened.push({ incident_type: type, year: yr, ...record });
                        });
                    });
                });

                if (!countyData) {
                    console.log("No disasters for county", countyFips);
                    return;
                }

                const flattenedCount = [];

                countyData.forEach((yearMap, type) => {
                    yearMap.forEach((records, yr) => {
                        records.forEach(record => {
                            flattenedCount.push({
                                incident_type: type,
                                year: yr,
                                county: feature.properties.name,
                                state: state,
                                ...record
                            });
                        });
                    });
                });

                // Filter by the selected year range
                const filteredData = flattened.filter(d => d.year >= startYear && d.year <= endYear);
                const filteredCountyData = flattenedCount.filter(d => d.year >= startYear && d.year <= endYear);
                updateCountyTable(
                    filteredCountyData,
                    feature.properties.name,
                    startYear,
                    endYear
                );

                if (filteredData.length === 0) {
                    console.log("No disasters for", state, "between", startYear, "and", endYear);
                    return;
                }

                // Set up Crossfilter
                const ndx = crossfilter(filteredData);
                const typeDim = ndx.dimension(d => d.incident_type);
                const typeGroup = typeDim.group().reduceCount();

                const dataTableCount = dc.dataCount(".dc-dataTable-count")
                    .crossfilter(typeDim)
                    .groupAll(typeGroup);

                console.log(dataTableCount);

                // Render the pie chart
                const pieChart = dc.pieChart("#pieChart")
                    .dimension(typeDim)
                    .group(typeGroup)
                    .useViewBoxResizing(true)
                    .width(300)
                    .height(300)
                    .colors(typeColorScale)
                    .colorAccessor(d => d.key)
                    .on("pretransition", function (chart) {
                        chart.selectAll("g.pie-slice")
                            .on("mouseover", function (event, d) {
                                div.transition()
                                    .duration(200)
                                    .style("opacity", 0.9);
                                div.html(`<strong>${d.data.key}</strong><br/>Count: ${d.value}`)
                                    .style("left", (event.pageX + 5) + "px")
                                    .style("top", (event.pageY - 28) + "px");
                            })
                            .on("mouseout", function () {
                                div.transition()
                                    .duration(200)
                                    .style("opacity", 0);
                            });
                    })
                    .render();

                d3.select("#countyPieChartTitle")
                    .text(`${feature.properties.name} County (${startYear} - ${endYear})`);

                // Use filteredCountyData instead of filteredData
                const ndxCounty = crossfilter(filteredCountyData);
                const typeDimCounty = ndxCounty.dimension(d => d.incident_type);
                const typeGroupCounty = typeDimCounty.group().reduceCount();

                dc.pieChart("#countyPieChart")
                    .dimension(typeDimCounty)
                    .group(typeGroupCounty)
                    .useViewBoxResizing(true)
                    .width(300)
                    .height(300)
                    .colors(typeColorScale)
                    .colorAccessor(d => d.key)
                    .on("pretransition", function (chart) {
                        chart.selectAll("g.pie-slice")
                            .on("mouseover", function (event, d) {
                                div.transition().duration(200).style("opacity", 0.9);
                                div.html(`<strong>${d.data.key}</strong><br/>Count: ${d.value}`)
                                    .style("left", (event.pageX + 5) + "px")
                                    .style("top", (event.pageY - 28) + "px");
                            })
                            .on("mouseout", function () {
                                div.transition().duration(200).style("opacity", 0);
                            });
                    })
                    .render();

                console.log("Pie chart rendered for", state, "between", startYear, "and", endYear);
            });
        }
    }).addTo(map);

    map.fitBounds(geoJsonLayer.getBounds());

    //create legend
    let legend = L.control({ position: 'bottomright' });

    legend.onAdd = function (map) {
        this._div = L.DomUtil.create('div', 'legend');
        this.update();
        return this._div;
    };

    //Updates the legend when a new classification is selected or time range changes
    legend.update = function () {

        const s = ClassifyStats;

        let breaks = [];
        let labels = [];

        if (classificationMode === "jenks") {
            breaks = s.breaks;
            labels = breaks.map((b, i) => {
                if (i === 0) return `≤ ${b.toFixed(2)}`;
                return `${breaks[i - 1].toFixed(2)} – ${b.toFixed(2)}`;
            });
        }

        else if (classificationMode === "equal") {
            const step = (s.max - s.min) / 5;

            for (let i = 0; i < 5; i++) {
                const low = s.min + i * step;
                const high = s.min + (i + 1) * step;

                labels.push(`${low.toFixed(2)} – ${high.toFixed(2)}`);
            }
        }

        else {
            // quantile
            const qs = [s.q1, s.q2, s.q3, s.q4, s.q5 || s.max];

            labels = qs.map((q, i) => {
                if (i === 0) return `≤ ${q.toFixed(2)}`;
                return `≤ ${q.toFixed(2)}`;
            });
        }

        let html = `<h4>Disaster Rate (${classificationMode})</h4>`;

        for (let i = 1; i <= 5; i++) {
            html += `
            <div style="display:flex; align-items:center; margin-bottom:4px;">
                <span style="
                    background:${getColorForClass(i)};
                    width:18px;
                    height:18px;
                    display:inline-block;
                    border:1px solid #666;
                    margin-right:6px;
                "></span>
                ${labels[i - 1] || ""}
            </div>
        `;
        }

        this._div.innerHTML = html;
    };

    legend.addTo(map);

    //Gets all county values from start year to end year
    function buildValues(startYear, endYear) {
        const values = [];

        disastersCountByCounty.forEach((yearMap) => {
            let total = 0;

            for (let y = startYear; y <= endYear; y++) {
                total += yearMap.get(y) || 0;
            }

            const avg = total / (endYear - startYear + 1);
            values.push(avg);
        });

        return values;
    }

    //Updates data table when new county is selected
    function updateCountyTable(data, countyName, startYear, endYear) {

        d3.select("#tableTitle")
            .text(`${countyName} County (${startYear} - ${endYear})`);

        const tbody = d3.select("#countyTable tbody");
        tbody.html(""); // clear old rows

        const rows = tbody.selectAll("tr")
            .data(data)
            .enter()
            .append("tr");

        rows.append("td").text(d => d.year);
        rows.append("td").text(d => d.incident_type);
        rows.append("td").text(d => d.state);
        rows.append("td").text(d => d.county);
    }

    const years = d3.extent(data, d => d.year);

    //Define range slider
    $("#rangeSlider").ionRangeSlider({
        type: "double",
        skin: "big",
        min: years[0],
        max: years[1],
        from: years[0],
        to: years[1],
        step: 1,
        onFinish: function (data) {
            updateMapRange(data.from, data.to);
            d3.select("#yearLabel").text(`${data.from} - ${data.to}`);
        },
        onChange: function (data) {
            updateMapRange(data.from, data.to);
            d3.select("#yearLabel").text(`${data.from} - ${data.to}`);
        }
    });

    //Update map when a new classification is selected
    document.getElementById("classDropdown").addEventListener("change", function (e) {
        classificationMode = e.target.value;

        const slider = $("#rangeSlider").data("ionRangeSlider");
        updateMapRange(slider.result.from, slider.result.to);
    });

    ClassifyStats = calculateQuantileStats(disastersCountByCounty, 1953, 2025);

    //update map when the slider is changed
    function updateMapRange(startYear, endYear) {
        const values = buildValues(startYear, endYear);
        ClassifyStats = buildStats(values, classificationMode);

        geoJsonLayer.eachLayer(function (layer) {
            const feature = layer.feature;
            const countyData = disastersCountByCounty.get(feature.id);
            let totalDisasters = 0;

            if (countyData) {
                for (let year = startYear; year <= endYear; year++) {
                    totalDisasters += countyData.get(year) || 0;
                }
            }

            // Calculate average annual declarations
            const numYears = endYear - startYear + 1;
            const avgAnnual = totalDisasters / numYears;
            const classValue = classifyValue(avgAnnual, ClassifyStats, classificationMode);
            const fillColor = getColorForClass(classValue);

            layer.setStyle({
                fillColor: fillColor,
                weight: 2,
                opacity: 1,
                color: '#fff',
                dashArray: '3',
                fillOpacity: 0.9
            });
        });
        legend.update();
    }
    updateMapRange(years[0], years[1]);
    d3.select("#yearLabel").text(`${years[0]} - ${years[1]}`);
});

//AI DISCLOSURE
//AI Generated code is partially used in the following functions:
//Legend Creation
//calculateQuantileStats
//updateMapRange
//reprojectCoordinates
//legend.Update()
//buildStats()
//classifyValue()